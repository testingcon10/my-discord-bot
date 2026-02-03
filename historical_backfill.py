#!/usr/bin/env python3
"""
================================================================================
HISTORICAL BACKFILL v1.0
Loads real historical NBA games to train the edge detection model
================================================================================

Data Sources:
- nba_api: Historical game data with scores
- Covers.com / historical odds data (manual or API)

Process:
1. Fetch past seasons of game results
2. Match with historical odds (where available)
3. Build feature vectors for each game
4. Store with actual outcomes for training

================================================================================
"""

import json
import os
import time
import pickle
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import random

try:
    import numpy as np
except ImportError:
    os.system('python -m pip install numpy')
    import numpy as np

try:
    from nba_api.stats.endpoints import leaguegamefinder, teamgamelog, leaguedashteamstats
    from nba_api.stats.static import teams as nba_teams_static
    NBA_API_AVAILABLE = True
except ImportError:
    NBA_API_AVAILABLE = False
    print("[WARN] nba_api not installed")


class HistoricalBackfill:
    """
    Loads historical game data and creates training vectors
    """
    
    SEASONS = ['2023-24', '2022-23', '2021-22', '2020-21']
    
    TEAM_MAP = {
        'ATL': 1610612737, 'BOS': 1610612738, 'BKN': 1610612751, 'CHA': 1610612766,
        'CHI': 1610612741, 'CLE': 1610612739, 'DAL': 1610612742, 'DEN': 1610612743,
        'DET': 1610612765, 'GSW': 1610612744, 'HOU': 1610612745, 'IND': 1610612754,
        'LAC': 1610612746, 'LAL': 1610612747, 'MEM': 1610612763, 'MIA': 1610612748,
        'MIL': 1610612749, 'MIN': 1610612750, 'NOP': 1610612740, 'NYK': 1610612752,
        'OKC': 1610612760, 'ORL': 1610612753, 'PHI': 1610612755, 'PHX': 1610612756,
        'POR': 1610612757, 'SAC': 1610612758, 'SAS': 1610612759, 'TOR': 1610612761,
        'UTA': 1610612762, 'WAS': 1610612764
    }
    
    ID_TO_ABBREV = {v: k for k, v in TEAM_MAP.items()}
    
    def __init__(self, output_file: str = 'historical_training_data.pkl'):
        self.output_file = output_file
        self.games = []
        self.team_season_stats = {}  # Cache for team stats by season
    
    def fetch_season_team_stats(self, season: str) -> Dict[str, Dict]:
        """
        Fetch team stats for a specific season
        """
        if season in self.team_season_stats:
            return self.team_season_stats[season]
        
        if not NBA_API_AVAILABLE:
            return {}
        
        print(f"  Fetching team stats for {season}...")
        
        try:
            time.sleep(0.6)
            
            stats = leaguedashteamstats.LeagueDashTeamStats(
                season=season,
                measure_type_detailed_defense='Advanced',
                per_mode_detailed='PerGame'
            )
            df = stats.get_data_frames()[0]
            
            team_stats = {}
            for _, row in df.iterrows():
                team_id = row.get('TEAM_ID')
                abbrev = self.ID_TO_ABBREV.get(team_id, '')
                
                if not abbrev:
                    continue
                
                team_stats[abbrev] = {
                    'off_rating': float(row.get('OFF_RATING', 110)),
                    'def_rating': float(row.get('DEF_RATING', 110)),
                    'net_rating': float(row.get('NET_RATING', 0)),
                    'pace': float(row.get('PACE', 100)),
                    'win_pct': float(row.get('W_PCT', 0.5))
                }
            
            self.team_season_stats[season] = team_stats
            return team_stats
            
        except Exception as e:
            print(f"    Error: {e}")
            return {}
    
    def fetch_season_games(self, season: str) -> List[Dict]:
        """
        Fetch all games from a season
        """
        if not NBA_API_AVAILABLE:
            return []
        
        print(f"  Fetching games for {season}...")
        
        try:
            time.sleep(0.6)
            
            finder = leaguegamefinder.LeagueGameFinder(
                season_nullable=season,
                league_id_nullable='00',
                season_type_nullable='Regular Season'
            )
            df = finder.get_data_frames()[0]
            
            # Group by game_id to get both teams
            game_dict = {}
            
            for _, row in df.iterrows():
                game_id = row.get('GAME_ID')
                team_id = row.get('TEAM_ID')
                abbrev = self.ID_TO_ABBREV.get(team_id, '')
                
                if not game_id or not abbrev:
                    continue
                
                matchup = row.get('MATCHUP', '')
                is_home = '@' not in matchup
                pts = int(row.get('PTS', 0))
                plus_minus = int(row.get('PLUS_MINUS', 0))
                wl = row.get('WL', '')
                
                if game_id not in game_dict:
                    game_dict[game_id] = {
                        'game_id': game_id,
                        'date': row.get('GAME_DATE', ''),
                        'season': season
                    }
                
                if is_home:
                    game_dict[game_id]['home_team'] = abbrev
                    game_dict[game_id]['home_pts'] = pts
                    game_dict[game_id]['home_won'] = wl == 'W'
                else:
                    game_dict[game_id]['away_team'] = abbrev
                    game_dict[game_id]['away_pts'] = pts
            
            # Filter complete games
            games = [g for g in game_dict.values() 
                    if 'home_team' in g and 'away_team' in g]
            
            print(f"    Found {len(games)} games")
            return games
            
        except Exception as e:
            print(f"    Error: {e}")
            return []
    
    def generate_historical_odds(self, home_stats: Dict, away_stats: Dict) -> Dict:
        """
        Generate simulated historical odds based on team stats
        (In production, you'd use actual historical odds data)
        """
        # Calculate expected spread based on net ratings
        home_advantage = 3.0  # Points for home court
        rating_diff = home_stats.get('net_rating', 0) - away_stats.get('net_rating', 0)
        
        expected_spread = -(rating_diff + home_advantage) / 2  # Negative = home favored
        
        # Add some noise to simulate market variance
        spread = expected_spread + random.gauss(0, 1)
        
        # Convert spread to moneyline (approximate)
        if spread < -10:
            home_ml = -400 + random.randint(-50, 50)
        elif spread < -5:
            home_ml = -200 + random.randint(-30, 30)
        elif spread < -2:
            home_ml = -130 + random.randint(-20, 20)
        elif spread < 2:
            home_ml = -110 + random.randint(-15, 15)
        elif spread < 5:
            home_ml = 110 + random.randint(-20, 20)
        elif spread < 10:
            home_ml = 180 + random.randint(-30, 30)
        else:
            home_ml = 300 + random.randint(-50, 50)
        
        # Total based on pace
        avg_pace = (home_stats.get('pace', 100) + away_stats.get('pace', 100)) / 2
        expected_total = 220 + (avg_pace - 100) * 2
        total = expected_total + random.gauss(0, 3)
        
        return {
            'spread': round(spread, 1),
            'total': round(total, 1),
            'home_ml': int(home_ml),
            'away_ml': -home_ml if home_ml < 0 else int(-100 * 100 / home_ml)
        }
    
    def build_training_vectors(self, games: List[Dict], team_stats: Dict) -> List[Tuple[np.ndarray, Dict]]:
        """
        Build 32-dimension training vectors from historical games
        """
        vectors = []
        
        for game in games:
            home = game.get('home_team')
            away = game.get('away_team')
            
            if not home or not away:
                continue
            
            home_stats = team_stats.get(home, {})
            away_stats = team_stats.get(away, {})
            
            if not home_stats or not away_stats:
                continue
            
            # Generate simulated odds
            odds = self.generate_historical_odds(home_stats, away_stats)
            
            # Calculate actual outcome
            home_pts = game.get('home_pts', 0)
            away_pts = game.get('away_pts', 0)
            margin = home_pts - away_pts
            total_pts = home_pts + away_pts
            
            home_won = margin > 0
            covered = margin > -odds['spread']
            went_over = total_pts > odds['total']
            
            # Build feature vector (simplified 32-dim)
            # In production, you'd have all the features
            vector = self._create_vector(home_stats, away_stats, odds)
            
            outcome = {
                'won': home_won,
                'covered': covered,
                'total_over': went_over,
                'margin': margin,
                'total_pts': total_pts
            }
            
            metadata = {
                'game_id': game.get('game_id'),
                'date': game.get('date'),
                'home': home,
                'away': away,
                'odds': odds,
                'outcome': outcome
            }
            
            vectors.append((vector, metadata))
        
        return vectors
    
    def _create_vector(self, home_stats: Dict, away_stats: Dict, odds: Dict) -> np.ndarray:
        """
        Create 32-dimension feature vector
        """
        def normalize(val, min_v, max_v):
            return max(0, min(1, (val - min_v) / (max_v - min_v))) if max_v != min_v else 0.5
        
        def ml_to_prob(ml):
            if ml == 0:
                return 0.5
            if ml < 0:
                return abs(ml) / (abs(ml) + 100)
            return 100 / (ml + 100)
        
        # Team fundamentals (8)
        team_off = normalize(home_stats.get('off_rating', 110), 100, 120)
        team_def = normalize(home_stats.get('def_rating', 110), 100, 120)
        team_net_L10 = normalize(home_stats.get('net_rating', 0), -15, 15)
        opp_off = normalize(away_stats.get('off_rating', 110), 100, 120)
        opp_def = normalize(away_stats.get('def_rating', 110), 100, 120)
        opp_net_L10 = normalize(away_stats.get('net_rating', 0), -15, 15)
        pace = normalize((home_stats.get('pace', 100) + away_stats.get('pace', 100)) / 2, 95, 105)
        pace_mismatch = normalize(abs(home_stats.get('pace', 100) - away_stats.get('pace', 100)), 0, 10)
        
        # Schedule/situational (8) - randomized for historical
        home_adv = 1.0
        rest_days = normalize(random.choice([1, 2, 2, 2, 3]), 0, 7)
        rest_advantage = normalize(random.gauss(0, 1), -4, 4)
        b2b = 1.0 if random.random() < 0.15 else 0.0
        travel = normalize(random.uniform(0, 2000), 0, 3000)
        altitude = 0.3  # Average
        tz_cross = normalize(random.choice([0, 0, 1, 1, 2]), 0, 3)
        game_importance = random.uniform(0.3, 0.7)
        
        # Player-level (6) - randomized for historical
        star_status = random.choice([1.0, 1.0, 1.0, 0.75, 0.5])
        star_mins = normalize(random.gauss(34, 2), 25, 40)
        backup_quality = random.uniform(0.4, 0.8)
        injury_impact = random.uniform(0.3, 0.7)
        opp_star = random.choice([1.0, 1.0, 1.0, 0.75, 0.5])
        opp_injury = random.uniform(0.3, 0.7)
        
        # Market signals (6)
        line_move = normalize(abs(random.gauss(0, 1)), 0, 5)
        line_velocity = normalize(random.uniform(0, 0.5), 0, 2)
        rlm = 0.5 + random.gauss(0, 0.15)
        public_pct = random.gauss(50, 10) / 100
        book_disagree = normalize(random.uniform(0, 1), 0, 2)
        steam = 1.0 if random.random() < 0.05 else 0.0
        
        # Betting lines (4)
        spread = normalize(odds['spread'], -15, 15)
        total = normalize(odds['total'], 200, 250)
        ml_prob = ml_to_prob(odds['home_ml'])
        opener_dir = 0.5
        
        vector = np.array([
            team_off, team_def, team_net_L10,
            opp_off, opp_def, opp_net_L10,
            pace, pace_mismatch,
            home_adv, rest_days, rest_advantage, b2b,
            travel, altitude, tz_cross, game_importance,
            star_status, star_mins, backup_quality,
            injury_impact, opp_star, opp_injury,
            line_move, line_velocity, rlm,
            public_pct, book_disagree, steam,
            spread, total, ml_prob, opener_dir
        ], dtype=np.float32)
        
        return vector
    
    def run_backfill(self, seasons: List[str] = None, save: bool = True) -> List[Tuple]:
        """
        Main backfill process
        """
        seasons = seasons or self.SEASONS
        
        print("\n" + "="*70)
        print("HISTORICAL BACKFILL")
        print("="*70)
        
        all_vectors = []
        
        for season in seasons:
            print(f"\n[{season}]")
            
            # Get team stats for this season
            team_stats = self.fetch_season_team_stats(season)
            
            if not team_stats:
                print(f"  Skipping - no team stats")
                continue
            
            # Get games
            games = self.fetch_season_games(season)
            
            if not games:
                print(f"  Skipping - no games")
                continue
            
            # Build vectors
            vectors = self.build_training_vectors(games, team_stats)
            print(f"  Built {len(vectors)} training vectors")
            
            all_vectors.extend(vectors)
        
        print(f"\n{'='*70}")
        print(f"TOTAL: {len(all_vectors)} training vectors")
        print(f"{'='*70}")
        
        if save and all_vectors:
            self.save_vectors(all_vectors)
        
        return all_vectors
    
    def save_vectors(self, vectors: List[Tuple]):
        """Save vectors to pickle file"""
        with open(self.output_file, 'wb') as f:
            pickle.dump({
                'vectors': vectors,
                'version': '1.0',
                'timestamp': datetime.now().isoformat(),
                'count': len(vectors)
            }, f)
        print(f"\n[SAVED] {self.output_file} ({len(vectors)} vectors)")
    
    def load_vectors(self) -> List[Tuple]:
        """Load vectors from pickle file"""
        if not os.path.exists(self.output_file):
            return []
        
        try:
            with open(self.output_file, 'rb') as f:
                data = pickle.load(f)
                return data.get('vectors', [])
        except:
            return []


def convert_to_edge_detector_format(backfill_vectors: List[Tuple], output_file: str = 'expanded_edges_v3.pkl'):
    """
    Convert backfill vectors to the format expected by ExpandedEdgeDetector
    """
    print(f"\nConverting {len(backfill_vectors)} vectors to edge detector format...")
    
    # The edge detector expects: List of (vector, {'game_data': {...}, 'outcome': {...}})
    converted = []
    
    for vector, metadata in backfill_vectors:
        converted.append((
            vector,
            {
                'game_data': {
                    'team': metadata.get('home'),
                    'opponent': metadata.get('away'),
                    'game_id': metadata.get('game_id'),
                    'date': metadata.get('date')
                },
                'outcome': metadata.get('outcome', {})
            }
        ))
    
    # Save in edge detector format
    with open(output_file, 'wb') as f:
        pickle.dump({
            'vectors': converted,
            'version': '3.0',
            'dimensions': 32,
            'timestamp': datetime.now().isoformat()
        }, f)
    
    print(f"[SAVED] {output_file}")
    return converted


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    print("\n" + "="*70)
    print("HISTORICAL BACKFILL v1.0")
    print("="*70)
    
    backfill = HistoricalBackfill()
    
    # Run backfill for recent seasons
    vectors = backfill.run_backfill(seasons=['2023-24', '2022-23'])
    
    if vectors:
        # Convert to edge detector format
        convert_to_edge_detector_format(vectors)
        
        # Show sample
        print("\n[Sample Training Data]")
        sample = vectors[0]
        vec, meta = sample
        print(f"  Game: {meta.get('home')} vs {meta.get('away')}")
        print(f"  Date: {meta.get('date')}")
        print(f"  Spread: {meta.get('odds', {}).get('spread')}")
        print(f"  Outcome: Won={meta.get('outcome', {}).get('won')}, Covered={meta.get('outcome', {}).get('covered')}")
        print(f"  Vector shape: {vec.shape}")
    
    print("\n" + "="*70)
