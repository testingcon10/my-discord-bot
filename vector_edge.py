#!/usr/bin/env python3
"""
VECTOR-BASED EDGE DETECTION SYSTEM
Uses embeddings to find profitable betting patterns

Architecture:
1. Historical data → Feature vectors → Store in vector DB
2. Live game state → Feature vector → Query similar situations
3. Return edges based on historical outcomes of similar situations

Features per game situation:
- Team efficiency metrics
- Pace/tempo
- Home/away
- Rest days
- Recent form (last 5 games)
- Opponent defensive rating
- Line movement
- Public betting %
"""

import json
import sys
import os
from datetime import datetime, timedelta
import pickle

try:
    import numpy as np
    from numpy.linalg import norm
except ImportError:
    print("Installing numpy...")
    os.system('python -m pip install numpy')
    import numpy as np
    from numpy.linalg import norm

# Simple vector store (no external dependencies)
class VectorStore:
    def __init__(self, filepath='vector_store.pkl'):
        self.filepath = filepath
        self.vectors = []  # List of (vector, metadata) tuples
        self.load()
    
    def load(self):
        """Load vectors from disk"""
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, 'rb') as f:
                    self.vectors = pickle.load(f)
                print(f"[VectorStore] Loaded {len(self.vectors)} vectors")
            except:
                self.vectors = []
    
    def save(self):
        """Save vectors to disk"""
        with open(self.filepath, 'wb') as f:
            pickle.dump(self.vectors, f)
        print(f"[VectorStore] Saved {len(self.vectors)} vectors")
    
    def add(self, vector, metadata):
        """Add a vector with metadata"""
        self.vectors.append((np.array(vector), metadata))
    
    def cosine_similarity(self, a, b):
        """Calculate cosine similarity between two vectors"""
        return np.dot(a, b) / (norm(a) * norm(b) + 1e-10)
    
    def query(self, vector, top_k=5, min_similarity=0.7):
        """Find most similar vectors"""
        query_vec = np.array(vector)
        results = []
        
        for stored_vec, metadata in self.vectors:
            sim = self.cosine_similarity(query_vec, stored_vec)
            if sim >= min_similarity:
                results.append({
                    'similarity': float(sim),
                    'metadata': metadata
                })
        
        # Sort by similarity
        results.sort(key=lambda x: x['similarity'], reverse=True)
        return results[:top_k]
    
    def clear(self):
        """Clear all vectors"""
        self.vectors = []


class EdgeDetector:
    """
    Vector-based edge detection for sports betting
    
    Each game situation is encoded as a feature vector:
    [
        team_off_rating,      # 0: Offensive efficiency (0-1 normalized)
        team_def_rating,      # 1: Defensive efficiency (0-1 normalized)
        opp_off_rating,       # 2: Opponent offensive efficiency
        opp_def_rating,       # 3: Opponent defensive efficiency
        pace,                 # 4: Game pace (possessions per game)
        home_away,            # 5: 1 = home, 0 = away
        rest_days,            # 6: Days since last game (normalized)
        recent_form,          # 7: Win% last 5 games
        season_win_pct,       # 8: Season win percentage
        line_movement,        # 9: How much line has moved (-1 to 1)
        public_pct,           # 10: Public betting % on this side
        total_over_under,     # 11: Normalized O/U line
        spread,               # 12: Normalized spread
        moneyline_implied,    # 13: Implied probability from ML
    ]
    """
    
    FEATURE_NAMES = [
        'team_off_rating', 'team_def_rating', 'opp_off_rating', 'opp_def_rating',
        'pace', 'home_away', 'rest_days', 'recent_form', 'season_win_pct',
        'line_movement', 'public_pct', 'total_over_under', 'spread', 'moneyline_implied'
    ]
    
    def __init__(self):
        self.store = VectorStore('edges_vector_store.pkl')
        self.edges_cache = {}
    
    def normalize(self, value, min_val, max_val):
        """Normalize value to 0-1 range"""
        if max_val == min_val:
            return 0.5
        return (value - min_val) / (max_val - min_val)
    
    def create_feature_vector(self, game_data):
        """
        Create a feature vector from game data
        
        game_data should contain:
        - team_off_rating: float (e.g., 112.5)
        - team_def_rating: float (e.g., 108.2)
        - opp_off_rating: float
        - opp_def_rating: float
        - pace: float (e.g., 100.5)
        - is_home: bool
        - rest_days: int
        - last_5_wins: int (0-5)
        - season_wins: int
        - season_games: int
        - line_open: float
        - line_current: float
        - public_pct: float (0-100)
        - total: float (e.g., 225.5)
        - spread: float (e.g., -5.5)
        - moneyline: int (e.g., -200)
        """
        
        # Normalize all features to 0-1 range
        vector = [
            self.normalize(game_data.get('team_off_rating', 110), 100, 120),
            self.normalize(game_data.get('team_def_rating', 110), 100, 120),
            self.normalize(game_data.get('opp_off_rating', 110), 100, 120),
            self.normalize(game_data.get('opp_def_rating', 110), 100, 120),
            self.normalize(game_data.get('pace', 100), 95, 105),
            1.0 if game_data.get('is_home', False) else 0.0,
            self.normalize(min(game_data.get('rest_days', 1), 7), 0, 7),
            game_data.get('last_5_wins', 2.5) / 5.0,
            game_data.get('season_wins', 0) / max(game_data.get('season_games', 1), 1),
            self.normalize(
                game_data.get('line_current', 0) - game_data.get('line_open', 0),
                -5, 5
            ),
            game_data.get('public_pct', 50) / 100.0,
            self.normalize(game_data.get('total', 220), 200, 250),
            self.normalize(game_data.get('spread', 0), -15, 15),
            self.ml_to_implied_prob(game_data.get('moneyline', -110))
        ]
        
        return np.array(vector)
    
    def ml_to_implied_prob(self, ml):
        """Convert American moneyline to implied probability"""
        if ml < 0:
            return abs(ml) / (abs(ml) + 100)
        else:
            return 100 / (ml + 100)
    
    def add_historical_game(self, game_data, outcome):
        """
        Add a historical game outcome to the vector store
        
        outcome should contain:
        - won: bool (did the team win)
        - covered: bool (did they cover the spread)
        - total_over: bool (did game go over)
        - profit_ml: float (profit on $100 ML bet)
        - profit_spread: float (profit on $100 spread bet)
        - profit_over: float (profit on $100 over bet)
        """
        vector = self.create_feature_vector(game_data)
        
        metadata = {
            'game_data': game_data,
            'outcome': outcome,
            'timestamp': datetime.now().isoformat()
        }
        
        self.store.add(vector, metadata)
    
    def find_edges(self, current_game, min_similarity=0.75, min_sample=5):
        """
        Find betting edges for current game based on similar historical situations
        
        Returns edges with confidence scores
        """
        vector = self.create_feature_vector(current_game)
        similar = self.store.query(vector, top_k=50, min_similarity=min_similarity)
        
        if len(similar) < min_sample:
            return {
                'status': 'INSUFFICIENT_DATA',
                'sample_size': len(similar),
                'edges': []
            }
        
        # Calculate win rates for similar situations
        ml_wins = sum(1 for s in similar if s['metadata']['outcome'].get('won', False))
        spread_covers = sum(1 for s in similar if s['metadata']['outcome'].get('covered', False))
        overs = sum(1 for s in similar if s['metadata']['outcome'].get('total_over', False))
        
        n = len(similar)
        
        # Calculate edge (actual win rate vs implied probability)
        implied_prob = current_game.get('implied_prob', 0.5)
        
        ml_rate = ml_wins / n
        spread_rate = spread_covers / n
        over_rate = overs / n
        
        edges = []
        
        # Moneyline edge
        ml_edge = ml_rate - implied_prob
        if abs(ml_edge) > 0.05:  # 5% edge threshold
            edges.append({
                'type': 'MONEYLINE',
                'direction': 'BET' if ml_edge > 0 else 'FADE',
                'edge': round(ml_edge * 100, 1),
                'win_rate': round(ml_rate * 100, 1),
                'sample_size': n,
                'confidence': min(n / 20, 1.0) * abs(ml_edge) * 2
            })
        
        # Spread edge
        spread_edge = spread_rate - 0.5  # vs 50% baseline
        if abs(spread_edge) > 0.05:
            edges.append({
                'type': 'SPREAD',
                'direction': 'COVER' if spread_edge > 0 else 'FADE',
                'edge': round(spread_edge * 100, 1),
                'win_rate': round(spread_rate * 100, 1),
                'sample_size': n,
                'confidence': min(n / 20, 1.0) * abs(spread_edge) * 2
            })
        
        # Total edge
        over_edge = over_rate - 0.5
        if abs(over_edge) > 0.05:
            edges.append({
                'type': 'TOTAL',
                'direction': 'OVER' if over_edge > 0 else 'UNDER',
                'edge': round(over_edge * 100, 1),
                'win_rate': round(over_rate * 100, 1),
                'sample_size': n,
                'confidence': min(n / 20, 1.0) * abs(over_edge) * 2
            })
        
        # Sort by confidence
        edges.sort(key=lambda x: x['confidence'], reverse=True)
        
        # Determine overall status
        if not edges:
            status = 'NO_EDGE'
        elif edges[0]['confidence'] > 0.7:
            status = 'STRONG_EDGE'
        elif edges[0]['confidence'] > 0.4:
            status = 'MODERATE_EDGE'
        else:
            status = 'WEAK_EDGE'
        
        return {
            'status': status,
            'sample_size': n,
            'avg_similarity': round(sum(s['similarity'] for s in similar) / n, 3),
            'edges': edges
        }
    
    def save(self):
        """Save vector store"""
        self.store.save()
    
    def get_stats(self):
        """Get store statistics"""
        return {
            'total_vectors': len(self.store.vectors),
            'feature_dimensions': len(self.FEATURE_NAMES)
        }


def generate_sample_data():
    """Generate sample historical data for testing"""
    import random
    
    detector = EdgeDetector()
    
    teams = ['LAL', 'BOS', 'GSW', 'MIA', 'PHX', 'DEN', 'MIL', 'PHI', 'NYK', 'DAL']
    
    print("[Vector] Generating sample historical data...")
    
    for i in range(500):
        # Random game situation
        team_off = random.uniform(105, 118)
        team_def = random.uniform(105, 115)
        opp_off = random.uniform(105, 118)
        opp_def = random.uniform(105, 115)
        
        game_data = {
            'team': random.choice(teams),
            'opponent': random.choice(teams),
            'team_off_rating': team_off,
            'team_def_rating': team_def,
            'opp_off_rating': opp_off,
            'opp_def_rating': opp_def,
            'pace': random.uniform(97, 103),
            'is_home': random.random() > 0.5,
            'rest_days': random.randint(1, 4),
            'last_5_wins': random.randint(0, 5),
            'season_wins': random.randint(20, 50),
            'season_games': random.randint(50, 70),
            'line_open': random.uniform(-10, 10),
            'line_current': random.uniform(-10, 10),
            'public_pct': random.uniform(30, 70),
            'total': random.uniform(210, 235),
            'spread': random.uniform(-12, 12),
            'moneyline': random.choice([-200, -150, -120, -110, 100, 110, 150, 200])
        }
        
        # Simulate outcome (better teams win more often)
        team_strength = (team_off - team_def) - (opp_off - opp_def)
        win_prob = 0.5 + team_strength / 30
        won = random.random() < win_prob
        
        outcome = {
            'won': won,
            'covered': random.random() < 0.52 if won else random.random() < 0.48,
            'total_over': random.random() < 0.5,
            'profit_ml': 100 if won else -100,
            'profit_spread': 91 if random.random() < 0.52 else -100,
            'profit_over': 91 if random.random() < 0.5 else -100
        }
        
        detector.add_historical_game(game_data, outcome)
    
    detector.save()
    print(f"[Vector] Generated {len(detector.store.vectors)} historical games")
    
    return detector


def export_edges_for_bot(detector):
    """Export current edges to JSON for bot consumption"""
    
    # Sample current games to analyze
    sample_games = [
        {
            'team': 'LAL',
            'opponent': 'BOS',
            'team_off_rating': 114.2,
            'team_def_rating': 110.5,
            'opp_off_rating': 117.8,
            'opp_def_rating': 108.2,
            'pace': 100.5,
            'is_home': False,
            'rest_days': 2,
            'last_5_wins': 3,
            'season_wins': 28,
            'season_games': 50,
            'line_open': 5.5,
            'line_current': 6.5,
            'public_pct': 45,
            'total': 228.5,
            'spread': 6.5,
            'moneyline': 220,
            'implied_prob': 0.31
        },
        {
            'team': 'GSW',
            'opponent': 'PHX',
            'team_off_rating': 115.5,
            'team_def_rating': 112.8,
            'opp_off_rating': 113.2,
            'opp_def_rating': 111.5,
            'pace': 101.2,
            'is_home': True,
            'rest_days': 1,
            'last_5_wins': 4,
            'season_wins': 32,
            'season_games': 52,
            'line_open': -3.5,
            'line_current': -4.5,
            'public_pct': 62,
            'total': 232.0,
            'spread': -4.5,
            'moneyline': -180,
            'implied_prob': 0.64
        }
    ]
    
    results = []
    
    for game in sample_games:
        edge_result = detector.find_edges(game)
        results.append({
            'team': game['team'],
            'opponent': game['opponent'],
            'spread': game['spread'],
            'total': game['total'],
            'moneyline': game['moneyline'],
            **edge_result
        })
    
    # Save for bot
    with open('vector_edges.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"[Vector] Exported {len(results)} game edges to vector_edges.json")
    
    return results


if __name__ == "__main__":
    print("=" * 60)
    print("VECTOR-BASED EDGE DETECTION")
    print("=" * 60)
    
    # Check if we have existing data
    detector = EdgeDetector()
    stats = detector.get_stats()
    
    if stats['total_vectors'] < 100:
        print("[Vector] Insufficient data, generating samples...")
        detector = generate_sample_data()
    else:
        print(f"[Vector] Loaded {stats['total_vectors']} historical vectors")
    
    # Export edges for bot
    edges = export_edges_for_bot(detector)
    
    print("\n" + "=" * 60)
    print("EDGE ANALYSIS RESULTS")
    print("=" * 60)
    
    for edge in edges:
        print(f"\n{edge['team']} vs {edge['opponent']}")
        print(f"  Status: {edge['status']}")
        print(f"  Sample Size: {edge['sample_size']}")
        if edge['edges']:
            for e in edge['edges']:
                print(f"  → {e['type']}: {e['direction']} ({e['edge']}% edge, {e['win_rate']}% win rate)")
