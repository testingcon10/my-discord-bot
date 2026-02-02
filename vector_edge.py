#!/usr/bin/env python3
"""
VECTOR-BASED EDGE DETECTION SYSTEM
Uses embeddings to find profitable betting patterns.

Architecture:
1. Historical data -> Feature vectors -> Store in vector DB (FAISS)
2. Live game state -> Feature vector -> Query similar situations
3. Return edges based on historical outcomes of similar situations
"""

import os
import sys
import pickle
import json
from datetime import datetime
from typing import List, Dict, Any, Optional

try:
    import numpy as np
    import faiss
except ImportError:
    print("Missing dependencies. Please run: pip install numpy faiss-cpu")
    faiss = None

# -----------------------------------------------------------------------------
# FAISS VECTOR STORE (Engine Layer)
# -----------------------------------------------------------------------------
class VectorStore:
    def __init__(self, filepath: str = 'vector_store.pkl', dimension: int = 14):
        self.filepath = filepath
        self.dimension = dimension
        self.vectors = []  # Metadata storage
        self.index = None
        
        if faiss:
            # IndexFlatIP = Inner Product. Normalized vectors + IP = Cosine Similarity
            self.index = faiss.IndexFlatIP(dimension)
        
        self.load()
    
    def load(self):
        """Load metadata from disk and rebuild FAISS index."""
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, 'rb') as f:
                    data = pickle.load(f)
                    
                    # Handle legacy format vs new dict format
                    if isinstance(data, list):
                        self.vectors = [item[1] for item in data]
                        loaded_vecs = [item[0] for item in data]
                    else:
                        self.vectors = data.get('metadata', [])
                        loaded_vecs = data.get('vectors', [])

                    # Rebuild FAISS index
                    if loaded_vecs and self.index:
                        self._add_to_index(loaded_vecs)
                        
                print(f"[VectorStore] Loaded {len(self.vectors)} vectors from {self.filepath}")
            except Exception as e:
                print(f"[VectorStore] Error loading file {self.filepath}: {e}")
                self.vectors = []
    
    def save(self):
        """Save vectors and metadata to disk."""
        if self.index and self.index.ntotal > 0:
            # Reconstruct vectors from FAISS index for persistent storage
            saved_vectors = self.index.reconstruct_n(0, self.index.ntotal)
            
            save_data = {
                'vectors': [v for v in saved_vectors],
                'metadata': self.vectors
            }
            
            with open(self.filepath, 'wb') as f:
                pickle.dump(save_data, f)
            print(f"[VectorStore] Saved {len(self.vectors)} vectors to {self.filepath}")
    
    def _add_to_index(self, vectors: List[Any]):
        """Helper to normalize and add vectors to FAISS."""
        if not self.index: return
        arr = np.array(vectors, dtype='float32')
        faiss.normalize_L2(arr)
        self.index.add(arr)
    
    def add(self, vector: np.ndarray, metadata: Dict):
        """Add a single vector with metadata."""
        if self.index:
            self._add_to_index([vector])
            self.vectors.append(metadata)
    
    def query(self, vector: np.ndarray, top_k: int = 5, min_similarity: float = 0.7) -> List[Dict]:
        """Find most similar vectors using FAISS."""
        if not self.index or self.index.ntotal == 0:
            return []
            
        query_vec = np.array([vector], dtype='float32')
        faiss.normalize_L2(query_vec)
        
        # D = distances (similarities), I = indices
        D, I = self.index.search(query_vec, top_k)
        
        results = []
        for i, idx in enumerate(I[0]):
            if idx != -1:  # -1 indicates "not found"
                similarity = float(D[0][i])
                if similarity >= min_similarity:
                    results.append({
                        'similarity': similarity,
                        'metadata': self.vectors[idx]
                    })
        return results

    def clear(self):
        self.vectors = []
        if self.index:
            self.index.reset()


# -----------------------------------------------------------------------------
# EDGE DETECTOR (Business Logic Base)
# -----------------------------------------------------------------------------
class EdgeDetector:
    """Base class for sports-specific betting models."""
    
    FEATURE_NAMES = [
        'team_off_rating', 'team_def_rating', 'opp_off_rating', 'opp_def_rating',
        'pace', 'home_away', 'rest_days', 'recent_form', 'season_win_pct',
        'line_movement', 'public_pct', 'total_over_under', 'spread', 'moneyline_implied'
    ]
    
    def __init__(self):
        # FIX: Dynamically determine dimension from subclass features
        dim = len(self.FEATURE_NAMES)
        self.store = VectorStore('edges_vector_store.pkl', dimension=dim)
    
    def normalize(self, value: float, min_val: float, max_val: float) -> float:
        """Normalize value to 0-1 range."""
        if max_val == min_val: return 0.5
        return (value - min_val) / (max_val - min_val)
    
    def create_feature_vector(self, game_data: Dict) -> np.ndarray:
        # Default placeholder (Overridden by subclasses)
        return np.zeros(len(self.FEATURE_NAMES), dtype='float32')
    
    def add_historical_game(self, game_data: Dict, outcome: Dict):
        vector = self.create_feature_vector(game_data)
        metadata = {
            'game_data': game_data,
            'outcome': outcome,
            'timestamp': datetime.now().isoformat()
        }
        self.store.add(vector, metadata)
    
    def find_edges(self, current_game: Dict, min_similarity: float = 0.75) -> Dict:
        vector = self.create_feature_vector(current_game)
        similar = self.store.query(vector, top_k=50, min_similarity=min_similarity)
        
        if len(similar) < 5:
            return {'status': 'INSUFFICIENT_DATA', 'sample_size': len(similar), 'edges': []}
        
        n = len(similar)
        # Calculate historical win rates
        ml_wins = sum(1 for s in similar if s['metadata']['outcome'].get('won', False))
        spread_covers = sum(1 for s in similar if s['metadata']['outcome'].get('covered', False))
        overs = sum(1 for s in similar if s['metadata']['outcome'].get('total_over', False))
        
        edges = []
        
        # Moneyline Logic
        ml_rate = ml_wins / n
        implied_prob = current_game.get('implied_prob', 0.5)
        ml_edge = ml_rate - implied_prob
        
        if abs(ml_edge) > 0.05:
            edges.append({
                'type': 'MONEYLINE',
                'direction': 'BET' if ml_edge > 0 else 'FADE',
                'edge': round(ml_edge * 100, 1),
                'win_rate': round(ml_rate * 100, 1),
                'confidence': min(n / 20, 1.0) * abs(ml_edge) * 2
            })
        
        # Spread Logic
        spread_rate = spread_covers / n
        spread_edge = spread_rate - 0.5
        if abs(spread_edge) > 0.05:
            edges.append({
                'type': 'SPREAD',
                'direction': 'COVER' if spread_edge > 0 else 'FADE',
                'edge': round(spread_edge * 100, 1),
                'win_rate': round(spread_rate * 100, 1),
                'confidence': min(n / 20, 1.0) * abs(spread_edge) * 2
            })

        edges.sort(key=lambda x: x.get('confidence', 0), reverse=True)
        
        return {
            'status': 'FOUND_EDGES' if edges else 'NO_EDGE',
            'sample_size': n,
            'avg_similarity': round(sum(s['similarity'] for s in similar) / n, 3),
            'edges': edges
        }

    def save(self):
        self.store.save()

if __name__ == "__main__":
    print("Vector Engine Core Loaded.")