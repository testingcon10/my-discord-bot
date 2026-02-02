import nfl_data_py as nfl
import pandas as pd
import numpy as np
from typing import Dict, Any, List
from vector_edge import EdgeDetector, VectorStore

class NFLEdgeDetector(EdgeDetector):
    """
    NFL-specific implementation.
    """
    
    # 12 Dimensions specific to Football
    FEATURE_NAMES = [
        'team_ppg_L5', 'team_oppg_L5', 'opp_ppg_L5', 'opp_oppg_L5',
        'is_home', 'rest_advantage', 'win_pct_L5', 'cover_pct_L5',
        'spread_line', 'total_line', 'implied_team_score', 'line_movement'
    ]

    # Normalization Constants
    MAX_PTS = 50
    MAX_REST = 7
    MAX_SPREAD = 21
    MAX_TOTAL = 60
    MIN_TOTAL = 30
    MAX_IMPLIED = 40
    MIN_IMPLIED = 10
    MAX_MOVE = 3

    def __init__(self):
        """Initialize with a specific NFL storage file."""
        dim = len(self.FEATURE_NAMES)
        # CRITICAL: Use a unique filename so we don't overwrite NBA/other data
        self.store = VectorStore('nfl_vector_store.pkl', dimension=dim)

    def create_feature_vector(self, game_data: Dict[str, Any]) -> np.ndarray:
        """Creates a normalized 12-dimensional vector for NFL games."""
        v = []
        
        # 1. Efficiency (Normalized 0-50 pts)
        v.append(self.normalize(game_data.get('team_ppg', 20), 0, self.MAX_PTS))
        v.append(self.normalize(game_data.get('team_oppg', 20), 0, self.MAX_PTS))
        v.append(self.normalize(game_data.get('opp_ppg', 20), 0, self.MAX_PTS))
        v.append(self.normalize(game_data.get('opp_oppg', 20), 0, self.MAX_PTS))

        # 2. Context
        v.append(1.0 if game_data.get('is_home', False) else 0.0)
        v.append(self.normalize(game_data.get('rest_diff', 0), -self.MAX_REST, self.MAX_REST))

        # 3. Form (Already 0-1)
        v.append(game_data.get('win_pct', 0.5))
        v.append(game_data.get('cover_pct', 0.5))

        # 4. Market
        v.append(self.normalize(game_data.get('spread', 0), -self.MAX_SPREAD, self.MAX_SPREAD))
        v.append(self.normalize(game_data.get('total', 45), self.MIN_TOTAL, self.MAX_TOTAL))
        
        # 5. Implied Score
        total = game_data.get('total', 45)
        spread = game_data.get('spread', 0)
        implied = (total / 2) - (spread / 2)
        v.append(self.normalize(implied, self.MIN_IMPLIED, self.MAX_IMPLIED))
        
        # 6. Line Movement
        v.append(self.normalize(game_data.get('line_move', 0), -self.MAX_MOVE, self.MAX_MOVE))

        return np.array(v, dtype=np.float32)

def load_real_nfl_data(years: List[int] = None):
    """Fetches NFL schedule data and builds the vector database."""
    if years is None:
        years = [2021, 2022, 2023, 2024] # Current data set

    print(f"[NFL-Loader] Fetching schedule data for {years}...")
    try:
        df = nfl.import_schedules(years)
    except Exception as e:
        print(f"[Error] Failed to fetch data: {e}")
        return

    # Filter for completed games with valid betting lines
    df = df.dropna(subset=['result', 'spread_line', 'total_line', 'home_score', 'away_score'])
    
    detector = NFLEdgeDetector()
    detector.store.clear()
    
    print(f"[NFL-Loader] Vectorizing {len(df)} games...")
    
    for _, row in df.iterrows():
        # TODO: Connect to detailed stats API for rolling averages
        # Currently using final score as proxy for efficiency in this loader
        game_context = {
            'team_ppg': row['home_score'],
            'team_oppg': row['away_score'],
            'opp_ppg': row['away_score'], 
            'opp_oppg': row['home_score'],
            'is_home': True,
            'rest_diff': 0, 
            'win_pct': 0.5,
            'cover_pct': 0.5,
            'spread': row['spread_line'],
            'total': row['total_line'],
            'line_move': 0
        }
        
        outcome = {
            'won': row['result'] > 0,
            'covered': row['result'] > row['spread_line'],
            'total_over': (row['home_score'] + row['away_score']) > row['total_line']
        }
        
        detector.add_historical_game(game_context, outcome)

    detector.save()
    print(f"[NFL-Loader] Database saved to 'nfl_vector_store.pkl'.")

if __name__ == "__main__":
    load_real_nfl_data()