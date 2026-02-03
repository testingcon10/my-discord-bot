#!/usr/bin/env python3
"""
================================================================================
ENHANCED EDGE DETECTOR v3.0
Expanded 32-Dimension Feature Vector
================================================================================

HIGH PRIORITY (Market Signals):
- Line movement velocity (how fast the line moved)
- Reverse line movement (public vs line direction)
- Book disagreement (spread across sportsbooks)
- Steam move detection (coordinated sharp action)

MEDIUM PRIORITY (Player + Situational):
- Star player status (OUT/GTD/IN)
- Star player minutes trend
- Backup quality rating
- Travel distance
- Back-to-back flag
- Time zone crossing
- Altitude adjustment

================================================================================
"""

import json
import os
import pickle
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import math

try:
    import numpy as np
    from numpy.linalg import norm
except ImportError:
    os.system('python -m pip install numpy')
    import numpy as np
    from numpy.linalg import norm

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False
    print("[INFO] FAISS not available. Install: pip install faiss-cpu")


class ExpandedEdgeDetector:
    """
    32-Dimension Feature Vector for Edge Detection
    
    ═══════════════════════════════════════════════════════════════════════════
    FEATURE VECTOR BREAKDOWN
    ═══════════════════════════════════════════════════════════════════════════
    
    TEAM FUNDAMENTALS (8 features) [0-7]
    ───────────────────────────────────────────────────────────────────────────
    [0]  team_off_rating        - Offensive efficiency (season)
    [1]  team_def_rating        - Defensive efficiency (season)
    [2]  team_net_rating_L10    - Net rating last 10 games (recent form)
    [3]  opp_off_rating         - Opponent offensive efficiency
    [4]  opp_def_rating         - Opponent defensive efficiency
    [5]  opp_net_rating_L10     - Opponent net rating last 10
    [6]  pace                   - Expected game pace
    [7]  pace_mismatch          - Pace differential (high = more variance)
    
    SCHEDULE/SITUATIONAL (8 features) [8-15]
    ───────────────────────────────────────────────────────────────────────────
    [8]  home_advantage         - 1 = home, 0 = away
    [9]  rest_days              - Days since last game
    [10] rest_advantage         - Team rest minus opponent rest
    [11] back_to_back           - 1 = 2nd night of B2B, 0 = not
    [12] travel_distance        - Miles traveled (normalized)
    [13] altitude               - 1 = Denver/Utah, 0.5 = mid, 0 = sea level
    [14] time_zone_cross        - Time zones crossed (0-3)
    [15] game_importance        - Playoff implications (0-1)
    
    PLAYER-LEVEL (6 features) [16-21]
    ───────────────────────────────────────────────────────────────────────────
    [16] star_player_status     - Best player: 1=IN, 0.5=GTD, 0=OUT
    [17] star_minutes_L5        - Star's minutes trend (up/down)
    [18] backup_quality         - Replacement player quality (0-1)
    [19] injury_impact_total    - Total team injury impact (-1 to 1)
    [20] opp_star_status        - Opponent's star status
    [21] opp_injury_impact      - Opponent's total injury impact
    
    MARKET SIGNALS - HIGH PRIORITY (6 features) [22-27]
    ───────────────────────────────────────────────────────────────────────────
    [22] line_movement          - Total line move from open (absolute)
    [23] line_velocity          - Speed of line movement (pts/hour)
    [24] reverse_line_movement  - 1 = line moving against public
    [25] public_pct             - Public betting percentage
    [26] book_disagreement      - Spread of odds across books (stdev)
    [27] steam_move             - 1 = detected sharp coordinated action
    
    BETTING LINES (4 features) [28-31]
    ───────────────────────────────────────────────────────────────────────────
    [28] spread                 - Current spread (from team perspective)
    [29] total_line             - Over/under line
    [30] ml_implied_prob        - Moneyline implied win probability
    [31] opener_vs_current      - Direction of move (1=toward team, -1=away)
    
    ═══════════════════════════════════════════════════════════════════════════
    """
    
    FEATURE_NAMES = [
        # Team Fundamentals (8)
        'team_off_rating', 'team_def_rating', 'team_net_rating_L10',
        'opp_off_rating', 'opp_def_rating', 'opp_net_rating_L10',
        'pace', 'pace_mismatch',
        
        # Schedule/Situational (8)
        'home_advantage', 'rest_days', 'rest_advantage', 'back_to_back',
        'travel_distance', 'altitude', 'time_zone_cross', 'game_importance',
        
        # Player-Level (6)
        'star_player_status', 'star_minutes_L5', 'backup_quality',
        'injury_impact_total', 'opp_star_status', 'opp_injury_impact',
        
        # Market Signals (6)
        'line_movement', 'line_velocity', 'reverse_line_movement',
        'public_pct', 'book_disagreement', 'steam_move',
        
        # Betting Lines (4)
        'spread', 'total_line', 'ml_implied_prob', 'opener_vs_current'
    ]
    
    VECTOR_DIM = 32
    
    # Thresholds
    EDGE_THRESHOLD = 0.03          # 3% minimum edge
    STRONG_EDGE_THRESHOLD = 0.06   # 6% = strong signal
    MIN_SAMPLE_SIZE = 10
    MIN_SIMILARITY = 0.70
    
    # Stadium altitudes (feet above sea level)
    ALTITUDES = {
        'DEN': 5280, 'UTA': 4226, 'PHX': 1086, 'SAC': 30, 'LAL': 233,
        'LAC': 233, 'GSW': 0, 'POR': 50, 'SEA': 0, 'OKC': 1201,
        'DAL': 430, 'SAS': 650, 'HOU': 50, 'MEM': 337, 'NOP': 3,
        'MIN': 815, 'MIL': 617, 'CHI': 594, 'IND': 715, 'DET': 600,
        'CLE': 653, 'ATL': 1050, 'MIA': 6, 'ORL': 82, 'CHA': 751,
        'WAS': 0, 'PHI': 39, 'NYK': 33, 'BKN': 33, 'BOS': 141, 'TOR': 250
    }
    
    # City coordinates for travel distance (lat, lon)
    CITY_COORDS = {
        'ATL': (33.749, -84.388), 'BOS': (42.361, -71.057), 'BKN': (40.683, -73.976),
        'CHA': (35.225, -80.839), 'CHI': (41.881, -87.674), 'CLE': (41.496, -81.688),
        'DAL': (32.790, -96.810), 'DEN': (39.749, -104.999), 'DET': (42.341, -83.055),
        'GSW': (37.768, -122.388), 'HOU': (29.751, -95.362), 'IND': (39.764, -86.156),
        'LAC': (34.043, -118.267), 'LAL': (34.043, -118.267), 'MEM': (35.138, -90.051),
        'MIA': (25.781, -80.188), 'MIL': (43.045, -87.918), 'MIN': (44.980, -93.276),
        'NOP': (29.949, -90.082), 'NYK': (40.751, -73.994), 'OKC': (35.463, -97.515),
        'ORL': (28.539, -81.384), 'PHI': (39.901, -75.172), 'PHX': (33.446, -112.071),
        'POR': (45.532, -122.667), 'SAC': (38.580, -121.500), 'SAS': (29.427, -98.438),
        'TOR': (43.643, -79.379), 'UTA': (40.768, -111.901), 'WAS': (38.898, -77.021)
    }
    
    # Time zones
    TIME_ZONES = {
        'LAL': -8, 'LAC': -8, 'GSW': -8, 'SAC': -8, 'POR': -8,
        'PHX': -7, 'DEN': -7, 'UTA': -7,
        'DAL': -6, 'SAS': -6, 'HOU': -6, 'MEM': -6, 'NOP': -6, 'OKC': -6, 'MIN': -6, 'MIL': -6, 'CHI': -6,
        'ATL': -5, 'BOS': -5, 'BKN': -5, 'CHA': -5, 'CLE': -5, 'DET': -5, 'IND': -5,
        'MIA': -5, 'NYK': -5, 'ORL': -5, 'PHI': -5, 'TOR': -5, 'WAS': -5
    }
    
    def __init__(self, store_path: str = 'expanded_edges_v3.pkl'):
        self.store_path = store_path
        self.vectors = []
        self.faiss_index = None
        self.line_history = {}  # Track line movements over time
        self.load()
    
    # =========================================================================
    # PERSISTENCE
    # =========================================================================
    
    def load(self):
        if os.path.exists(self.store_path):
            try:
                with open(self.store_path, 'rb') as f:
                    data = pickle.load(f)
                if isinstance(data, dict):
                    self.vectors = data.get('vectors', [])
                    self.line_history = data.get('line_history', {})
                else:
                    self.vectors = data if isinstance(data, list) else []
                print(f"[EdgeDetector v3] Loaded {len(self.vectors)} vectors")
                if FAISS_AVAILABLE and self.vectors:
                    self._build_faiss_index()
            except Exception as e:
                print(f"[EdgeDetector v3] Load error: {e}")
                self.vectors = []
    
    def save(self):
        with open(self.store_path, 'wb') as f:
            pickle.dump({
                'vectors': self.vectors,
                'line_history': self.line_history,
                'version': '3.0',
                'dimensions': self.VECTOR_DIM,
                'timestamp': datetime.now().isoformat()
            }, f)
        print(f"[EdgeDetector v3] Saved {len(self.vectors)} vectors")
    
    def _build_faiss_index(self):
        if not FAISS_AVAILABLE or not self.vectors:
            return
        vecs = np.array([v[0] for v in self.vectors], dtype=np.float32)
        faiss.normalize_L2(vecs)
        self.faiss_index = faiss.IndexFlatIP(self.VECTOR_DIM)
        self.faiss_index.add(vecs)
        print(f"[FAISS] Built index: {self.faiss_index.ntotal} vectors, {self.VECTOR_DIM} dimensions")

    # =========================================================================
    # HELPER CALCULATIONS
    # =========================================================================
    
    def _normalize(self, value: float, min_val: float, max_val: float) -> float:
        if max_val == min_val:
            return 0.5
        return max(0.0, min(1.0, (value - min_val) / (max_val - min_val)))
    
    def _ml_to_prob(self, ml: int) -> float:
        if ml == 0:
            return 0.5
        if ml < 0:
            return abs(ml) / (abs(ml) + 100)
        return 100 / (ml + 100)
    
    def _haversine_distance(self, coord1: Tuple[float, float], coord2: Tuple[float, float]) -> float:
        """Calculate distance between two points in miles"""
        lat1, lon1 = math.radians(coord1[0]), math.radians(coord1[1])
        lat2, lon2 = math.radians(coord2[0]), math.radians(coord2[1])
        
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
        c = 2 * math.asin(math.sqrt(a))
        
        return c * 3956  # Earth radius in miles
    
    def calculate_travel_distance(self, from_team: str, to_team: str) -> float:
        """Calculate travel distance in miles"""
        from_coord = self.CITY_COORDS.get(from_team.upper())
        to_coord = self.CITY_COORDS.get(to_team.upper())
        
        if not from_coord or not to_coord:
            return 0
        
        return self._haversine_distance(from_coord, to_coord)
    
    def calculate_altitude_factor(self, team: str) -> float:
        """Returns normalized altitude factor (0-1, higher = more altitude)"""
        alt = self.ALTITUDES.get(team.upper(), 500)
        return self._normalize(alt, 0, 5280)  # Denver is max
    
    def calculate_timezone_cross(self, from_team: str, to_team: str) -> int:
        """Calculate time zones crossed"""
        from_tz = self.TIME_ZONES.get(from_team.upper(), -6)
        to_tz = self.TIME_ZONES.get(to_team.upper(), -6)
        return abs(from_tz - to_tz)

    # =========================================================================
    # MARKET SIGNAL CALCULATIONS (HIGH PRIORITY)
    # =========================================================================
    
    def track_line(self, game_id: str, timestamp: datetime, spread: float, books: Dict[str, float]):
        """
        Track line movement over time for a game
        
        Args:
            game_id: Unique game identifier
            timestamp: When this line was recorded
            spread: Current spread
            books: Dict of {book_name: spread} for disagreement calc
        """
        if game_id not in self.line_history:
            self.line_history[game_id] = []
        
        self.line_history[game_id].append({
            'timestamp': timestamp.isoformat() if isinstance(timestamp, datetime) else timestamp,
            'spread': spread,
            'books': books
        })
    
    def calculate_line_velocity(self, game_id: str) -> float:
        """
        Calculate how fast the line is moving (points per hour)
        High velocity = sharp action
        """
        history = self.line_history.get(game_id, [])
        
        if len(history) < 2:
            return 0.0
        
        # Get first and last entries
        first = history[0]
        last = history[-1]
        
        try:
            t1 = datetime.fromisoformat(first['timestamp'])
            t2 = datetime.fromisoformat(last['timestamp'])
            hours = (t2 - t1).total_seconds() / 3600
            
            if hours < 0.1:  # Less than 6 minutes
                return 0.0
            
            spread_change = abs(last['spread'] - first['spread'])
            return spread_change / hours
        except:
            return 0.0
    
    def detect_reverse_line_movement(self, public_pct: float, line_open: float, line_current: float) -> float:
        """
        Detect when line moves AGAINST public betting
        
        If public is 70% on Team A, but line moves toward Team B,
        that's reverse line movement (sharp money on Team B)
        
        Returns: 1.0 = strong RLM, 0.5 = neutral, 0.0 = no RLM
        """
        if public_pct == 50:
            return 0.5
        
        line_moved_toward_team = line_current < line_open  # More negative = more favored
        public_on_team = public_pct > 50
        
        # RLM: public on team but line moving away
        if public_on_team and not line_moved_toward_team:
            strength = min((public_pct - 50) / 30, 1.0)  # Scale by how lopsided public is
            return 0.5 + (strength * 0.5)
        
        # Opposite: line confirms public (no edge signal)
        return 0.5 - (abs(public_pct - 50) / 100 * 0.3)
    
    def calculate_book_disagreement(self, book_odds: Dict) -> float:
        """
        Calculate standard deviation of odds across books
        High disagreement = market uncertainty = potential edge
        
        Args:
            book_odds: Dict of {book_name: spread} OR nested dict from best_odds
        
        Returns:
            Normalized disagreement (0-1)
        """
        if not book_odds:
            return 0.0
        
        # Extract numeric values, handling nested dicts
        values = []
        for k, v in book_odds.items():
            if v is None:
                continue
            if isinstance(v, (int, float)):
                values.append(float(v))
            elif isinstance(v, dict):
                # Handle nested dict like {'odds': -110, 'book': 'DK', 'point': -5.5}
                if 'point' in v and v['point'] is not None:
                    values.append(float(v['point']))
                elif 'odds' in v and v['odds'] is not None and v['odds'] != -9999:
                    values.append(float(v['odds']))
        
        if len(values) < 2:
            return 0.0
        
        stdev = np.std(values)
        
        # Normalize: 0.5 point stdev is low, 2+ is high
        return self._normalize(stdev, 0, 2)
    
    def detect_steam_move(self, game_id: str, threshold_pts: float = 0.5, threshold_minutes: int = 5) -> bool:
        """
        Detect steam move: rapid coordinated line movement across books
        
        A steam move is when multiple books move the line in the same
        direction within minutes - indicates sharp syndicate action
        """
        history = self.line_history.get(game_id, [])
        
        if len(history) < 2:
            return False
        
        recent = history[-2:]
        
        try:
            t1 = datetime.fromisoformat(recent[0]['timestamp'])
            t2 = datetime.fromisoformat(recent[1]['timestamp'])
            minutes = (t2 - t1).total_seconds() / 60
            
            if minutes > threshold_minutes:
                return False
            
            spread_change = abs(recent[1]['spread'] - recent[0]['spread'])
            return spread_change >= threshold_pts
        except:
            return False

    # =========================================================================
    # PLAYER-LEVEL CALCULATIONS (MEDIUM PRIORITY)
    # =========================================================================
    
    def calculate_star_status(self, injuries: List[Dict], team: str, star_players: List[str] = None) -> Tuple[float, float]:
        """
        Calculate star player availability
        
        Returns: (status, injury_impact)
            status: 1.0 = playing, 0.5 = GTD, 0.0 = OUT
            injury_impact: -1 to 1 (negative = team hurt by injuries)
        """
        if not injuries:
            return 1.0, 0.0
        
        team_injuries = [i for i in injuries if i.get('team', '').upper() == team.upper()]
        
        if not team_injuries:
            return 1.0, 0.0
        
        # Default star players by team (simplified - would expand this)
        default_stars = {
            'BOS': ['Jayson Tatum', 'Jaylen Brown'],
            'MIL': ['Giannis Antetokounmpo', 'Damian Lillard'],
            'DEN': ['Nikola Jokic', 'Jamal Murray'],
            'LAL': ['LeBron James', 'Anthony Davis'],
            'PHX': ['Kevin Durant', 'Devin Booker'],
            'GSW': ['Stephen Curry', 'Draymond Green'],
            'DAL': ['Luka Doncic', 'Kyrie Irving'],
            'PHI': ['Joel Embiid', 'Tyrese Maxey'],
            'MIA': ['Jimmy Butler', 'Bam Adebayo'],
            'NYK': ['Jalen Brunson', 'Julius Randle'],
            'OKC': ['Shai Gilgeous-Alexander', 'Chet Holmgren'],
            'MIN': ['Anthony Edwards', 'Karl-Anthony Towns'],
            'CLE': ['Donovan Mitchell', 'Darius Garland'],
            'SAC': ['De\'Aaron Fox', 'Domantas Sabonis'],
        }
        
        stars = star_players or default_stars.get(team.upper(), [])
        
        star_status = 1.0
        total_impact = 0.0
        
        for inj in team_injuries:
            player = inj.get('player', '')
            status = inj.get('status', '').upper()
            
            # Check if star player
            is_star = any(star.lower() in player.lower() for star in stars)
            
            # Calculate status
            if status == 'OUT':
                if is_star:
                    star_status = min(star_status, 0.0)
                total_impact -= 0.3 if is_star else 0.1
            elif status == 'DOUBTFUL':
                if is_star:
                    star_status = min(star_status, 0.25)
                total_impact -= 0.2 if is_star else 0.05
            elif status == 'QUESTIONABLE':
                if is_star:
                    star_status = min(star_status, 0.5)
                total_impact -= 0.1 if is_star else 0.02
            elif status == 'PROBABLE':
                if is_star:
                    star_status = min(star_status, 0.75)
        
        return star_status, max(-1.0, min(1.0, total_impact))
    
    def calculate_backup_quality(self, team: str, position: str = None) -> float:
        """
        Estimate backup quality (would integrate with real roster data)
        
        Returns: 0-1 scale (1 = excellent depth, 0 = poor depth)
        """
        # Simplified team depth ratings (would be dynamic in production)
        team_depth = {
            'BOS': 0.85, 'DEN': 0.80, 'MIL': 0.75, 'PHX': 0.70, 'LAL': 0.65,
            'GSW': 0.75, 'MIA': 0.80, 'PHI': 0.60, 'CLE': 0.75, 'DAL': 0.65,
            'OKC': 0.80, 'MIN': 0.70, 'SAC': 0.65, 'NYK': 0.70, 'IND': 0.70
        }
        return team_depth.get(team.upper(), 0.5)

    # =========================================================================
    # FEATURE VECTOR CREATION
    # =========================================================================
    
    def create_feature_vector(self, game_data: Dict) -> np.ndarray:
        """
        Create 32-dimension feature vector from game data
        
        Expected game_data keys:
        - team, opponent: Team abbreviations
        - team_off_rating, team_def_rating, opp_off_rating, opp_def_rating
        - team_net_L10, opp_net_L10: Recent form
        - pace, opp_pace
        - is_home: bool
        - rest_days, opp_rest_days: int
        - back_to_back: bool
        - last_location: Previous game location (for travel calc)
        - injuries: List of injury dicts
        - line_open, line_current: Spreads
        - public_pct: 0-100
        - book_odds: Dict of {book: spread}
        - total_line, moneyline
        - game_importance: 0-1
        - game_id: For line tracking
        """
        
        team = game_data.get('team', '')
        opp = game_data.get('opponent', '')
        
        # Team Fundamentals (8)
        team_off = self._normalize(game_data.get('team_off_rating', 110), 100, 120)
        team_def = self._normalize(game_data.get('team_def_rating', 110), 100, 120)
        team_net_L10 = self._normalize(game_data.get('team_net_L10', 0), -15, 15)
        opp_off = self._normalize(game_data.get('opp_off_rating', 110), 100, 120)
        opp_def = self._normalize(game_data.get('opp_def_rating', 110), 100, 120)
        opp_net_L10 = self._normalize(game_data.get('opp_net_L10', 0), -15, 15)
        
        team_pace = game_data.get('pace', 100)
        opp_pace = game_data.get('opp_pace', 100)
        pace = self._normalize((team_pace + opp_pace) / 2, 95, 105)
        pace_mismatch = self._normalize(abs(team_pace - opp_pace), 0, 10)
        
        # Schedule/Situational (8)
        home_adv = 1.0 if game_data.get('is_home', False) else 0.0
        rest_days = self._normalize(min(game_data.get('rest_days', 2), 7), 0, 7)
        rest_adv = self._normalize(
            game_data.get('rest_days', 2) - game_data.get('opp_rest_days', 2), -4, 4
        )
        b2b = 1.0 if game_data.get('back_to_back', False) else 0.0
        
        # Travel distance
        last_loc = game_data.get('last_location', team)
        game_loc = team if game_data.get('is_home', False) else opp
        travel = self._normalize(self.calculate_travel_distance(last_loc, game_loc), 0, 3000)
        
        altitude = self.calculate_altitude_factor(game_loc)
        tz_cross = self._normalize(self.calculate_timezone_cross(last_loc, game_loc), 0, 3)
        game_imp = game_data.get('game_importance', 0.5)
        
        # Player-Level (6)
        injuries = game_data.get('injuries', [])
        star_status, injury_impact = self.calculate_star_status(injuries, team)
        star_mins = self._normalize(game_data.get('star_minutes_L5', 34), 25, 40)
        backup_qual = self.calculate_backup_quality(team)
        
        opp_star, opp_inj_impact = self.calculate_star_status(injuries, opp)
        
        # Market Signals (6) - HIGH PRIORITY
        line_open = game_data.get('line_open', 0)
        line_current = game_data.get('line_current', 0)
        line_move = self._normalize(abs(line_current - line_open), 0, 5)
        
        game_id = game_data.get('game_id', f"{team}_{opp}")
        line_vel = self._normalize(self.calculate_line_velocity(game_id), 0, 2)
        
        public_pct = game_data.get('public_pct', 50)
        rlm = self.detect_reverse_line_movement(public_pct, line_open, line_current)
        
        book_odds = game_data.get('book_odds', {})
        book_disagree = self.calculate_book_disagreement(book_odds)
        
        steam = 1.0 if self.detect_steam_move(game_id) else 0.0
        
        # Betting Lines (4)
        spread = self._normalize(game_data.get('spread', 0), -15, 15)
        total = self._normalize(game_data.get('total_line', 220), 200, 250)
        ml_prob = self._ml_to_prob(game_data.get('moneyline', -110))
        opener_dir = 0.5
        if line_current != line_open:
            opener_dir = 1.0 if line_current < line_open else 0.0  # Negative = more favored
        
        vector = np.array([
            # Team Fundamentals (8)
            team_off, team_def, team_net_L10,
            opp_off, opp_def, opp_net_L10,
            pace, pace_mismatch,
            # Schedule/Situational (8)
            home_adv, rest_days, rest_adv, b2b,
            travel, altitude, tz_cross, game_imp,
            # Player-Level (6)
            star_status, star_mins, backup_qual,
            (injury_impact + 1) / 2,  # Normalize -1 to 1 → 0 to 1
            opp_star,
            (opp_inj_impact + 1) / 2,
            # Market Signals (6)
            line_move, line_vel, rlm,
            public_pct / 100,
            book_disagree, steam,
            # Betting Lines (4)
            spread, total, ml_prob, opener_dir
        ], dtype=np.float32)
        
        return vector

    # =========================================================================
    # SIMILARITY SEARCH & EDGE DETECTION
    # =========================================================================
    
    def find_similar_games(self, vector: np.ndarray, top_k: int = 50) -> List[Dict]:
        if FAISS_AVAILABLE and self.faiss_index is not None:
            query = vector.reshape(1, -1).astype(np.float32)
            faiss.normalize_L2(query)
            distances, indices = self.faiss_index.search(query, min(top_k, len(self.vectors)))
            
            results = []
            for dist, idx in zip(distances[0], indices[0]):
                if idx >= 0 and dist >= self.MIN_SIMILARITY:
                    _, meta = self.vectors[idx]
                    results.append({'similarity': float(dist), 'metadata': meta})
            return results
        else:
            # Fallback numpy search
            results = []
            query_norm = vector / (norm(vector) + 1e-10)
            
            for stored_vec, metadata in self.vectors:
                stored_norm = stored_vec / (norm(stored_vec) + 1e-10)
                sim = np.dot(query_norm, stored_norm)
                if sim >= self.MIN_SIMILARITY:
                    results.append({'similarity': float(sim), 'metadata': metadata})
            
            results.sort(key=lambda x: x['similarity'], reverse=True)
            return results[:top_k]
    
    def detect_edges(self, game_data: Dict) -> Dict:
        """Main edge detection - returns betting recommendations"""
        
        vector = self.create_feature_vector(game_data)
        similar = self.find_similar_games(vector)
        
        if len(similar) < self.MIN_SAMPLE_SIZE:
            return {
                'status': 'INSUFFICIENT_DATA',
                'sample_size': len(similar),
                'edges': []
            }
        
        # Calculate outcomes from similar games
        total_weight = sum(g['similarity'] for g in similar)
        
        ml_wins = sum(g['similarity'] * (1 if g['metadata']['outcome'].get('won') else 0) for g in similar)
        spread_covers = sum(g['similarity'] * (1 if g['metadata']['outcome'].get('covered') else 0) for g in similar)
        overs = sum(g['similarity'] * (1 if g['metadata']['outcome'].get('total_over') else 0) for g in similar)
        
        target_ml = ml_wins / total_weight
        target_spread = spread_covers / total_weight
        target_over = overs / total_weight
        
        # Market implied
        draft_ml = self._ml_to_prob(game_data.get('moneyline', -110))
        
        # Calculate edges
        edges = []
        
        ml_edge = target_ml - draft_ml
        if abs(ml_edge) >= self.EDGE_THRESHOLD:
            edges.append({
                'type': 'MONEYLINE',
                'direction': 'BET' if ml_edge > 0 else 'FADE',
                'advantage': round(ml_edge * 100, 1),
                'target_prob': round(target_ml * 100, 1),
                'market_prob': round(draft_ml * 100, 1),
                'strength': 'STRONG' if abs(ml_edge) >= self.STRONG_EDGE_THRESHOLD else 'MODERATE',
                'confidence': round(min(len(similar) / 30, 1.0) * abs(ml_edge) * 10, 2)
            })
        
        spread_edge = target_spread - 0.5
        if abs(spread_edge) >= self.EDGE_THRESHOLD:
            edges.append({
                'type': 'SPREAD',
                'direction': 'COVER' if spread_edge > 0 else 'FADE',
                'advantage': round(spread_edge * 100, 1),
                'target_prob': round(target_spread * 100, 1),
                'market_prob': 50.0,
                'strength': 'STRONG' if abs(spread_edge) >= self.STRONG_EDGE_THRESHOLD else 'MODERATE',
                'confidence': round(min(len(similar) / 30, 1.0) * abs(spread_edge) * 10, 2)
            })
        
        over_edge = target_over - 0.5
        if abs(over_edge) >= self.EDGE_THRESHOLD:
            edges.append({
                'type': 'TOTAL',
                'direction': 'OVER' if over_edge > 0 else 'UNDER',
                'advantage': round(over_edge * 100, 1),
                'target_prob': round(target_over * 100, 1),
                'market_prob': 50.0,
                'strength': 'STRONG' if abs(over_edge) >= self.STRONG_EDGE_THRESHOLD else 'MODERATE',
                'confidence': round(min(len(similar) / 30, 1.0) * abs(over_edge) * 10, 2)
            })
        
        # Boost confidence for high-priority signals
        rlm = self.detect_reverse_line_movement(
            game_data.get('public_pct', 50),
            game_data.get('line_open', 0),
            game_data.get('line_current', 0)
        )
        
        if rlm > 0.7:  # Strong reverse line movement
            for edge in edges:
                edge['confidence'] *= 1.2
                edge['signals'] = edge.get('signals', []) + ['REVERSE_LINE_MOVEMENT']
        
        if self.detect_steam_move(game_data.get('game_id', '')):
            for edge in edges:
                edge['confidence'] *= 1.3
                edge['signals'] = edge.get('signals', []) + ['STEAM_MOVE']
        
        edges.sort(key=lambda x: x['confidence'], reverse=True)
        
        status = 'NO_EDGE'
        if edges:
            if any(e['strength'] == 'STRONG' for e in edges):
                status = 'STRONG_EDGE'
            else:
                status = 'MODERATE_EDGE'
        
        return {
            'status': status,
            'sample_size': len(similar),
            'avg_similarity': round(sum(g['similarity'] for g in similar) / len(similar), 3),
            'edges': edges
        }

    # =========================================================================
    # TRAINING DATA
    # =========================================================================
    
    def add_historical_game(self, game_data: Dict, outcome: Dict):
        vector = self.create_feature_vector(game_data)
        self.vectors.append((vector, {'game_data': game_data, 'outcome': outcome}))
        
        if FAISS_AVAILABLE and len(self.vectors) % 100 == 0:
            self._build_faiss_index()


def generate_training_data(detector: ExpandedEdgeDetector, num_games: int = 1000):
    """Generate realistic training data with expanded features"""
    import random
    
    print(f"[Training] Generating {num_games} games with 32-dim vectors...")
    
    teams = list(detector.CITY_COORDS.keys())
    
    for i in range(num_games):
        team = random.choice(teams)
        opp = random.choice([t for t in teams if t != team])
        is_home = random.random() > 0.5
        
        # Generate realistic game data
        team_off = random.gauss(110, 5)
        team_def = random.gauss(110, 5)
        opp_off = random.gauss(110, 5)
        opp_def = random.gauss(110, 5)
        
        game_data = {
            'team': team,
            'opponent': opp,
            'team_off_rating': team_off,
            'team_def_rating': team_def,
            'team_net_L10': random.gauss(0, 5),
            'opp_off_rating': opp_off,
            'opp_def_rating': opp_def,
            'opp_net_L10': random.gauss(0, 5),
            'pace': random.gauss(100, 3),
            'opp_pace': random.gauss(100, 3),
            'is_home': is_home,
            'rest_days': random.choice([1, 2, 2, 2, 3, 3, 4]),
            'opp_rest_days': random.choice([1, 2, 2, 2, 3, 3, 4]),
            'back_to_back': random.random() < 0.15,
            'last_location': random.choice(teams),
            'injuries': [],
            'star_minutes_L5': random.gauss(34, 3),
            'line_open': random.gauss(0, 6),
            'line_current': random.gauss(0, 6),
            'public_pct': random.gauss(50, 15),
            'book_odds': {f'Book{i}': random.gauss(0, 0.5) for i in range(5)},
            'total_line': random.gauss(225, 10),
            'spread': random.gauss(0, 6),
            'moneyline': random.choice([-300, -200, -150, -120, -110, 100, 120, 150, 200, 300]),
            'game_importance': random.random(),
            'game_id': f"game_{i}"
        }
        
        # Simulate outcome based on features
        home_boost = 3 if is_home else 0
        team_strength = (team_off - team_def) - (opp_off - opp_def) + home_boost
        
        # Add noise
        actual_margin = random.gauss(team_strength, 12)
        
        outcome = {
            'won': actual_margin > 0,
            'covered': actual_margin > -game_data['spread'],
            'total_over': random.random() > 0.5,
            'margin': round(actual_margin)
        }
        
        detector.add_historical_game(game_data, outcome)
    
    detector.save()
    print(f"[Training] Complete: {len(detector.vectors)} vectors")


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    print("\n" + "="*70)
    print("EXPANDED EDGE DETECTOR v3.0")
    print("32-Dimension Feature Vector")
    print("="*70)
    
    detector = ExpandedEdgeDetector()
    
    if len(detector.vectors) < 500:
        generate_training_data(detector, 1000)
        detector._build_faiss_index()
    
    # Test with sample game
    test_game = {
        'team': 'BOS',
        'opponent': 'MIA',
        'team_off_rating': 118.5,
        'team_def_rating': 108.2,
        'team_net_L10': 8.5,
        'opp_off_rating': 112.3,
        'opp_def_rating': 110.5,
        'opp_net_L10': 2.1,
        'pace': 98.5,
        'opp_pace': 96.2,
        'is_home': True,
        'rest_days': 2,
        'opp_rest_days': 1,
        'back_to_back': False,
        'last_location': 'BOS',
        'injuries': [
            {'team': 'MIA', 'player': 'Jimmy Butler', 'status': 'OUT'}
        ],
        'star_minutes_L5': 35.2,
        'line_open': -6.5,
        'line_current': -7.5,  # Line moved toward Boston
        'public_pct': 45,       # Public on Miami, but line moving to Boston = RLM
        'book_odds': {'DK': -7.5, 'FD': -7.0, 'MGM': -7.5, 'CZR': -8.0},
        'total_line': 218.5,
        'spread': -7.5,
        'moneyline': -280,
        'game_importance': 0.7,
        'game_id': 'BOS_MIA_test'
    }
    
    result = detector.detect_edges(test_game)
    
    print(f"\nBOS vs MIA Analysis:")
    print(f"  Status: {result['status']}")
    print(f"  Sample Size: {result['sample_size']}")
    print(f"  Avg Similarity: {result.get('avg_similarity', 0):.1%}")
    
    if result['edges']:
        print("\n  EDGES:")
        for e in result['edges']:
            signals = ', '.join(e.get('signals', [])) or 'None'
            print(f"    {e['type']}: {e['direction']} ({e['advantage']:+.1f}%)")
            print(f"      Target: {e['target_prob']:.1f}% | Market: {e['market_prob']:.1f}%")
            print(f"      Confidence: {e['confidence']:.2f} | Signals: {signals}")
    
    print("\n" + "="*70)
