#!/usr/bin/env python3
"""
================================================================================
ENHANCED EDGE DETECTOR v2.0
Based on ARBITRAGE paper: "Efficient Reasoning via Advantage-Aware Speculation"
================================================================================

Key Concepts from Paper:
1. DRAFT MODEL = Market Consensus (sportsbook lines)
2. TARGET MODEL = Our calculated fair value (statistical model)
3. ADVANTAGE (α) = Target - Draft (the edge)
4. ROUTER = Only bet when |α| > threshold (advantage-aware)

Enhanced Features:
- Injury-adjusted projections
- Pace-adjusted scoring
- Rest advantage calculation
- Public money fade indicators
- Line movement signals
- Historical pattern matching via FAISS

================================================================================
"""

import json
import os
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import pickle

# Dependencies
try:
    import numpy as np
    from numpy.linalg import norm
except ImportError:
    os.system('python -m pip install numpy')
    import numpy as np
    from numpy.linalg import norm

# Optional FAISS
try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False
    print("[INFO] FAISS not available. Using numpy similarity. Install: pip install faiss-cpu")


class EnhancedEdgeDetector:
    """
    ARBITRAGE Paper Implementation:
    
    The key insight is that we have two models:
    1. Draft Model (D): The market's implied probability (fast, generic)
    2. Target Model (T): Our statistical model (slower, more accurate)
    
    The ADVANTAGE α = P(T) - P(D)
    
    We only "escalate" (bet) when α > threshold
    
    Feature Vector (18 dimensions):
    ─────────────────────────────────────────────────────────────────────
    [0]  team_off_rating      - Offensive efficiency (pts/100 poss)
    [1]  team_def_rating      - Defensive efficiency  
    [2]  opp_off_rating       - Opponent offensive efficiency
    [3]  opp_def_rating       - Opponent defensive efficiency
    [4]  pace                 - Expected possessions
    [5]  home_advantage       - 1 = home, 0 = away
    [6]  rest_days            - Days since last game (normalized)
    [7]  rest_advantage       - Team rest - Opponent rest
    [8]  recent_form_5        - Win% last 5 games
    [9]  recent_form_10       - Win% last 10 games
    [10] season_win_pct       - Season record
    [11] injury_impact        - Key player availability (-1 to 1)
    [12] line_movement        - How much line moved from open
    [13] line_direction       - 1 = moving toward team, -1 = away
    [14] public_pct           - Public betting % (fade indicator)
    [15] total_line           - Normalized O/U
    [16] spread               - Point spread (from team perspective)
    [17] ml_implied_prob      - Market implied win probability
    ─────────────────────────────────────────────────────────────────────
    """
    
    FEATURE_NAMES = [
        'team_off_rating', 'team_def_rating', 'opp_off_rating', 'opp_def_rating',
        'pace', 'home_advantage', 'rest_days', 'rest_advantage',
        'recent_form_5', 'recent_form_10', 'season_win_pct', 'injury_impact',
        'line_movement', 'line_direction', 'public_pct', 'total_line',
        'spread', 'ml_implied_prob'
    ]
    
    VECTOR_DIM = len(FEATURE_NAMES)
    
    # Thresholds (from paper)
    EDGE_THRESHOLD = 0.03      # 3% minimum edge to bet
    STRONG_EDGE_THRESHOLD = 0.07  # 7% = strong signal
    MIN_SAMPLE_SIZE = 10       # Minimum similar games
    MIN_SIMILARITY = 0.75      # Cosine similarity threshold
    
    def __init__(self, store_path: str = 'enhanced_edges.pkl'):
        self.store_path = store_path
        self.vectors = []       # List of (vector, metadata)
        self.faiss_index = None
        self.load()
    
    # =========================================================================
    # PERSISTENCE
    # =========================================================================
    
    def load(self):
        """Load existing vector store"""
        if os.path.exists(self.store_path):
            try:
                with open(self.store_path, 'rb') as f:
                    data = pickle.load(f)
                
                # Handle different formats
                if isinstance(data, list):
                    self.vectors = data
                elif isinstance(data, dict):
                    self.vectors = data.get('vectors', [])
                
                print(f"[EdgeDetector] Loaded {len(self.vectors)} vectors")
                
                # Build FAISS index if available
                if FAISS_AVAILABLE and len(self.vectors) > 0:
                    self._build_faiss_index()
                    
            except Exception as e:
                print(f"[EdgeDetector] Load error: {e}")
                self.vectors = []
    
    def save(self):
        """Save vector store"""
        with open(self.store_path, 'wb') as f:
            pickle.dump({
                'vectors': self.vectors,
                'version': '2.0',
                'timestamp': datetime.now().isoformat()
            }, f)
        print(f"[EdgeDetector] Saved {len(self.vectors)} vectors")
    
    def _build_faiss_index(self):
        """Build FAISS index for fast similarity search"""
        if not FAISS_AVAILABLE or len(self.vectors) == 0:
            return
        
        # Extract vectors
        vecs = np.array([v[0] for v in self.vectors], dtype=np.float32)
        
        # Normalize for cosine similarity
        faiss.normalize_L2(vecs)
        
        # Build index
        self.faiss_index = faiss.IndexFlatIP(self.VECTOR_DIM)  # Inner product = cosine after normalization
        self.faiss_index.add(vecs)
        
        print(f"[FAISS] Built index with {self.faiss_index.ntotal} vectors")

    # =========================================================================
    # FEATURE ENGINEERING
    # =========================================================================
    
    def normalize(self, value: float, min_val: float, max_val: float) -> float:
        """Normalize to 0-1 range"""
        if max_val == min_val:
            return 0.5
        return max(0, min(1, (value - min_val) / (max_val - min_val)))
    
    def ml_to_prob(self, ml: int) -> float:
        """Convert American moneyline to implied probability"""
        if ml == 0:
            return 0.5
        if ml < 0:
            return abs(ml) / (abs(ml) + 100)
        return 100 / (ml + 100)
    
    def create_feature_vector(self, game_data: Dict) -> np.ndarray:
        """
        Create normalized feature vector from game data
        
        Expected game_data keys:
        - team_off_rating, team_def_rating: float (100-120 typical NBA)
        - opp_off_rating, opp_def_rating: float
        - pace: float (95-105 typical)
        - is_home: bool
        - team_rest_days, opp_rest_days: int
        - last_5_wins, last_10_wins: int (0-5, 0-10)
        - season_wins, season_games: int
        - injury_impact: float (-1 to 1, negative = team hurt by injuries)
        - line_open, line_current: float (spread)
        - public_pct: float (0-100)
        - total_line: float (200-250 typical NBA)
        - spread: float (-15 to +15)
        - moneyline: int
        """
        
        # Calculate rest advantage
        team_rest = game_data.get('team_rest_days', 2)
        opp_rest = game_data.get('opp_rest_days', 2)
        rest_adv = team_rest - opp_rest
        
        # Calculate line movement
        line_open = game_data.get('line_open', 0)
        line_current = game_data.get('line_current', 0)
        line_move = line_current - line_open
        line_dir = 1 if line_move < 0 else (-1 if line_move > 0 else 0)  # Negative spread = favored
        
        # Season record
        season_wins = game_data.get('season_wins', 0)
        season_games = game_data.get('season_games', 1)
        win_pct = season_wins / max(season_games, 1)
        
        vector = np.array([
            self.normalize(game_data.get('team_off_rating', 110), 100, 120),
            self.normalize(game_data.get('team_def_rating', 110), 100, 120),
            self.normalize(game_data.get('opp_off_rating', 110), 100, 120),
            self.normalize(game_data.get('opp_def_rating', 110), 100, 120),
            self.normalize(game_data.get('pace', 100), 95, 105),
            1.0 if game_data.get('is_home', False) else 0.0,
            self.normalize(min(team_rest, 7), 0, 7),
            self.normalize(rest_adv, -3, 3),
            game_data.get('last_5_wins', 2.5) / 5.0,
            game_data.get('last_10_wins', 5) / 10.0,
            win_pct,
            (game_data.get('injury_impact', 0) + 1) / 2,  # -1 to 1 → 0 to 1
            self.normalize(abs(line_move), 0, 5),
            (line_dir + 1) / 2,  # -1 to 1 → 0 to 1
            game_data.get('public_pct', 50) / 100.0,
            self.normalize(game_data.get('total_line', 220), 200, 250),
            self.normalize(game_data.get('spread', 0), -15, 15),
            self.ml_to_prob(game_data.get('moneyline', -110))
        ], dtype=np.float32)
        
        return vector

    # =========================================================================
    # HISTORICAL DATA
    # =========================================================================
    
    def add_historical_game(self, game_data: Dict, outcome: Dict):
        """
        Add a completed game to the vector store
        
        outcome should contain:
        - won: bool
        - covered: bool (beat the spread)
        - total_over: bool (game went over)
        - margin: int (win/loss margin)
        - total_score: int (combined score)
        """
        vector = self.create_feature_vector(game_data)
        
        metadata = {
            'game_data': game_data,
            'outcome': outcome,
            'timestamp': datetime.now().isoformat()
        }
        
        self.vectors.append((vector, metadata))
        
        # Rebuild FAISS index periodically
        if FAISS_AVAILABLE and len(self.vectors) % 100 == 0:
            self._build_faiss_index()

    # =========================================================================
    # EDGE DETECTION (ARBITRAGE Paper Core Logic)
    # =========================================================================
    
    def find_similar_games(self, vector: np.ndarray, top_k: int = 50) -> List[Dict]:
        """Find most similar historical games"""
        
        if FAISS_AVAILABLE and self.faiss_index is not None:
            # Use FAISS for fast search
            query = vector.reshape(1, -1).astype(np.float32)
            faiss.normalize_L2(query)
            
            distances, indices = self.faiss_index.search(query, min(top_k, len(self.vectors)))
            
            results = []
            for i, (dist, idx) in enumerate(zip(distances[0], indices[0])):
                if idx >= 0 and dist >= self.MIN_SIMILARITY:
                    vec, meta = self.vectors[idx]
                    results.append({
                        'similarity': float(dist),
                        'metadata': meta
                    })
            
            return results
        
        else:
            # Fallback to numpy
            results = []
            query_norm = vector / (norm(vector) + 1e-10)
            
            for stored_vec, metadata in self.vectors:
                stored_norm = stored_vec / (norm(stored_vec) + 1e-10)
                sim = np.dot(query_norm, stored_norm)
                
                if sim >= self.MIN_SIMILARITY:
                    results.append({
                        'similarity': float(sim),
                        'metadata': metadata
                    })
            
            results.sort(key=lambda x: x['similarity'], reverse=True)
            return results[:top_k]
    
    def calculate_target_probability(self, similar_games: List[Dict]) -> Dict:
        """
        Calculate TARGET MODEL probability from similar historical games
        This is our "expensive but accurate" model from the paper
        """
        if len(similar_games) < self.MIN_SAMPLE_SIZE:
            return {'error': 'insufficient_data', 'sample_size': len(similar_games)}
        
        # Weight by similarity
        total_weight = sum(g['similarity'] for g in similar_games)
        
        # Moneyline (win probability)
        ml_wins = sum(
            g['similarity'] * (1 if g['metadata']['outcome'].get('won', False) else 0)
            for g in similar_games
        )
        ml_prob = ml_wins / total_weight
        
        # Spread (cover probability)
        spread_covers = sum(
            g['similarity'] * (1 if g['metadata']['outcome'].get('covered', False) else 0)
            for g in similar_games
        )
        spread_prob = spread_covers / total_weight
        
        # Total (over probability)
        total_overs = sum(
            g['similarity'] * (1 if g['metadata']['outcome'].get('total_over', False) else 0)
            for g in similar_games
        )
        over_prob = total_overs / total_weight
        
        return {
            'ml_prob': ml_prob,
            'spread_prob': spread_prob,
            'over_prob': over_prob,
            'sample_size': len(similar_games),
            'avg_similarity': total_weight / len(similar_games)
        }
    
    def detect_edges(self, game_data: Dict) -> Dict:
        """
        Main edge detection function
        
        Implements the ARBITRAGE paper's advantage-aware routing:
        α (advantage) = Target_Prob - Draft_Prob (market implied)
        
        Only returns edges where |α| > threshold
        """
        vector = self.create_feature_vector(game_data)
        similar = self.find_similar_games(vector)
        
        if len(similar) < self.MIN_SAMPLE_SIZE:
            return {
                'status': 'INSUFFICIENT_DATA',
                'sample_size': len(similar),
                'required': self.MIN_SAMPLE_SIZE,
                'edges': []
            }
        
        # Calculate TARGET MODEL probabilities
        target = self.calculate_target_probability(similar)
        
        if 'error' in target:
            return {
                'status': 'CALCULATION_ERROR',
                'error': target['error'],
                'edges': []
            }
        
        # Get DRAFT MODEL probabilities (market implied)
        draft_ml = self.ml_to_prob(game_data.get('moneyline', -110))
        draft_spread = 0.5  # Market assumes 50% ATS
        draft_over = 0.5    # Market assumes 50% O/U
        
        # Calculate ADVANTAGES (α)
        ml_advantage = target['ml_prob'] - draft_ml
        spread_advantage = target['spread_prob'] - draft_spread
        over_advantage = target['over_prob'] - draft_over
        
        edges = []
        
        # MONEYLINE EDGE
        if abs(ml_advantage) >= self.EDGE_THRESHOLD:
            strength = 'STRONG' if abs(ml_advantage) >= self.STRONG_EDGE_THRESHOLD else 'MODERATE'
            edges.append({
                'type': 'MONEYLINE',
                'direction': 'BET' if ml_advantage > 0 else 'FADE',
                'advantage': round(ml_advantage * 100, 1),  # As percentage
                'target_prob': round(target['ml_prob'] * 100, 1),
                'market_prob': round(draft_ml * 100, 1),
                'strength': strength,
                'confidence': round(min(target['sample_size'] / 30, 1.0) * abs(ml_advantage) * 10, 2)
            })
        
        # SPREAD EDGE
        if abs(spread_advantage) >= self.EDGE_THRESHOLD:
            strength = 'STRONG' if abs(spread_advantage) >= self.STRONG_EDGE_THRESHOLD else 'MODERATE'
            edges.append({
                'type': 'SPREAD',
                'direction': 'COVER' if spread_advantage > 0 else 'FADE',
                'advantage': round(spread_advantage * 100, 1),
                'target_prob': round(target['spread_prob'] * 100, 1),
                'market_prob': 50.0,
                'strength': strength,
                'confidence': round(min(target['sample_size'] / 30, 1.0) * abs(spread_advantage) * 10, 2)
            })
        
        # TOTAL EDGE
        if abs(over_advantage) >= self.EDGE_THRESHOLD:
            strength = 'STRONG' if abs(over_advantage) >= self.STRONG_EDGE_THRESHOLD else 'MODERATE'
            edges.append({
                'type': 'TOTAL',
                'direction': 'OVER' if over_advantage > 0 else 'UNDER',
                'advantage': round(over_advantage * 100, 1),
                'target_prob': round(target['over_prob'] * 100, 1),
                'market_prob': 50.0,
                'strength': strength,
                'confidence': round(min(target['sample_size'] / 30, 1.0) * abs(over_advantage) * 10, 2)
            })
        
        # Sort by confidence
        edges.sort(key=lambda x: x['confidence'], reverse=True)
        
        # Determine overall status
        if not edges:
            status = 'NO_EDGE'
        elif any(e['strength'] == 'STRONG' for e in edges):
            status = 'STRONG_EDGE'
        else:
            status = 'MODERATE_EDGE'
        
        return {
            'status': status,
            'sample_size': target['sample_size'],
            'avg_similarity': round(target['avg_similarity'], 3),
            'edges': edges,
            'meta': {
                'target_model': target,
                'draft_model': {
                    'ml_prob': round(draft_ml, 3),
                    'spread_prob': draft_spread,
                    'over_prob': draft_over
                }
            }
        }

    # =========================================================================
    # BEST EXECUTION (Platform Selection)
    # =========================================================================
    
    def find_best_execution(self, edges: List[Dict], odds_comparison: List[Dict]) -> List[Dict]:
        """
        Given edges and multi-book odds, find the best platform to execute
        
        This is the execution layer that finds where to place bets
        for maximum value
        """
        execution_plan = []
        
        for edge in edges:
            edge_type = edge['type']
            direction = edge['direction']
            
            best_book = None
            best_odds = None
            
            for game_odds in odds_comparison:
                # Match the edge type to available odds
                if edge_type == 'MONEYLINE':
                    h2h = game_odds.get('h2h', {})
                    for book, teams in h2h.items():
                        # Find the relevant team odds
                        for team, odds in teams.items():
                            if (direction == 'BET' and odds > (best_odds or -9999)) or \
                               (direction == 'FADE' and odds < (best_odds or 9999)):
                                best_odds = odds
                                best_book = book
                
                elif edge_type == 'SPREAD':
                    spreads = game_odds.get('spreads', {})
                    for book, teams in spreads.items():
                        for team, data in teams.items():
                            price = data.get('price', -110)
                            if price > (best_odds or -9999):
                                best_odds = price
                                best_book = book
                
                elif edge_type == 'TOTAL':
                    totals = game_odds.get('totals', {})
                    target = 'Over' if direction == 'OVER' else 'Under'
                    for book, outcomes in totals.items():
                        if target in outcomes:
                            price = outcomes[target].get('price', -110)
                            if price > (best_odds or -9999):
                                best_odds = price
                                best_book = book
            
            if best_book:
                execution_plan.append({
                    'edge': edge,
                    'best_book': best_book,
                    'best_odds': best_odds,
                    'ev': self._calculate_ev(edge, best_odds)
                })
        
        return sorted(execution_plan, key=lambda x: x['ev'], reverse=True)
    
    def _calculate_ev(self, edge: Dict, odds: int) -> float:
        """Calculate expected value of a bet"""
        prob = edge['target_prob'] / 100
        
        if odds < 0:
            profit = 100 / abs(odds)
        else:
            profit = odds / 100
        
        ev = (prob * profit) - ((1 - prob) * 1)
        return round(ev, 3)


# =============================================================================
# SAMPLE DATA GENERATOR
# =============================================================================

def generate_training_data(detector: EnhancedEdgeDetector, num_games: int = 500):
    """Generate synthetic training data"""
    import random
    
    print(f"\n[Training] Generating {num_games} synthetic games...")
    
    for i in range(num_games):
        # Random game situation
        team_off = random.uniform(105, 118)
        team_def = random.uniform(105, 115)
        opp_off = random.uniform(105, 118)
        opp_def = random.uniform(105, 115)
        
        is_home = random.random() > 0.5
        team_rest = random.randint(1, 4)
        opp_rest = random.randint(1, 4)
        
        game_data = {
            'team_off_rating': team_off,
            'team_def_rating': team_def,
            'opp_off_rating': opp_off,
            'opp_def_rating': opp_def,
            'pace': random.uniform(97, 103),
            'is_home': is_home,
            'team_rest_days': team_rest,
            'opp_rest_days': opp_rest,
            'last_5_wins': random.randint(0, 5),
            'last_10_wins': random.randint(0, 10),
            'season_wins': random.randint(20, 50),
            'season_games': random.randint(50, 70),
            'injury_impact': random.uniform(-0.5, 0.5),
            'line_open': random.uniform(-10, 10),
            'line_current': random.uniform(-10, 10),
            'public_pct': random.uniform(30, 70),
            'total_line': random.uniform(210, 235),
            'spread': random.uniform(-12, 12),
            'moneyline': random.choice([-300, -200, -150, -130, -110, 100, 110, 130, 150, 200, 300])
        }
        
        # Simulate realistic outcome based on features
        team_strength = (team_off - team_def) - (opp_off - opp_def)
        home_boost = 3 if is_home else 0
        rest_boost = (team_rest - opp_rest) * 0.5
        
        effective_edge = team_strength + home_boost + rest_boost + game_data['injury_impact'] * 5
        win_prob = 0.5 + effective_edge / 40
        win_prob = max(0.1, min(0.9, win_prob))
        
        won = random.random() < win_prob
        margin = abs(random.gauss(effective_edge, 10))
        if not won:
            margin = -margin
        
        total_score = random.gauss(game_data['total_line'], 15)
        
        outcome = {
            'won': won,
            'covered': margin > -game_data['spread'],
            'total_over': total_score > game_data['total_line'],
            'margin': round(margin),
            'total_score': round(total_score)
        }
        
        detector.add_historical_game(game_data, outcome)
    
    detector.save()
    print(f"[Training] Generated and saved {num_games} games")


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    print("\n" + "="*70)
    print("ENHANCED EDGE DETECTOR v2.0")
    print("Based on ARBITRAGE Paper: Advantage-Aware Speculation")
    print("="*70)
    
    detector = EnhancedEdgeDetector()
    
    # Generate training data if needed
    if len(detector.vectors) < 100:
        generate_training_data(detector, 500)
        detector._build_faiss_index() if FAISS_AVAILABLE else None
    
    print(f"\n[Status] {len(detector.vectors)} historical games loaded")
    
    # Test with sample game
    sample_game = {
        'team_off_rating': 115.2,
        'team_def_rating': 108.5,
        'opp_off_rating': 112.8,
        'opp_def_rating': 111.2,
        'pace': 101.5,
        'is_home': True,
        'team_rest_days': 2,
        'opp_rest_days': 1,
        'last_5_wins': 4,
        'last_10_wins': 7,
        'season_wins': 35,
        'season_games': 55,
        'injury_impact': 0.2,  # Slight advantage (opponent has injuries)
        'line_open': -5.5,
        'line_current': -6.5,  # Line moved toward team (sharp money)
        'public_pct': 45,      # Public betting against (good sign)
        'total_line': 228.5,
        'spread': -6.5,
        'moneyline': -250
    }
    
    print("\n" + "-"*70)
    print("SAMPLE EDGE DETECTION")
    print("-"*70)
    
    result = detector.detect_edges(sample_game)
    
    print(f"\nStatus: {result['status']}")
    print(f"Sample Size: {result['sample_size']} similar games")
    print(f"Avg Similarity: {result.get('avg_similarity', 0):.1%}")
    
    if result['edges']:
        print("\nEDGES FOUND:")
        for edge in result['edges']:
            print(f"  {edge['type']}: {edge['direction']}")
            print(f"    Advantage: {edge['advantage']:+.1f}%")
            print(f"    Target: {edge['target_prob']:.1f}% vs Market: {edge['market_prob']:.1f}%")
            print(f"    Strength: {edge['strength']} | Confidence: {edge['confidence']:.2f}")
    else:
        print("\nNo actionable edges found (market is efficient)")
    
    print("\n" + "="*70)
