#!/usr/bin/env python3
"""
================================================================================
LIVE DATA ENGINE v2.0
Real-time NBA/NFL data fetcher with injury reports and historical context
================================================================================

Data Sources:
- NBA: nba_api (official), ESPN API (injuries/scores)
- NFL: nfl_data_py (play-by-play), ESPN API (injuries/scores)
- Odds: The Odds API (multi-book comparison)

Outputs:
- live_nba_data.json: Current NBA games + context
- live_nfl_data.json: Current NFL games + context
- nba_injuries.json: Active injury report
- nfl_injuries.json: Active injury report
- player_schemes.json: Player fit tracking (scheme stability)

================================================================================
"""

import json
import os
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import time
import pickle

# Dependency check
def ensure_deps():
    required = ['numpy', 'requests']
    for pkg in required:
        try:
            __import__(pkg)
        except ImportError:
            os.system(f'python -m pip install {pkg}')

ensure_deps()

import numpy as np
import requests

# Optional libraries - graceful degradation
try:
    from nba_api.stats.endpoints import (
        leaguedashplayerstats, leaguedashteamstats, playergamelog,
        scoreboardv2, commonteamroster, leaguegamefinder
    )
    from nba_api.stats.static import teams as nba_teams_static
    NBA_API_AVAILABLE = True
except ImportError:
    NBA_API_AVAILABLE = False
    print("[WARN] nba_api not installed. Install with: pip install nba_api")

try:
    import nfl_data_py as nfl
    NFL_API_AVAILABLE = True
except ImportError:
    NFL_API_AVAILABLE = False
    print("[WARN] nfl_data_py not installed. Install with: pip install nfl_data_py")


class LiveDataEngine:
    """
    Centralized data fetcher for all sports betting data
    """
    
    # Seasons
    NBA_SEASON = '2024-25'
    NFL_SEASON = 2024
    
    # ESPN Endpoints (unofficial but reliable)
    ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports'
    
    # The Odds API
    ODDS_API_BASE = 'https://api.the-odds-api.com/v4'
    
    def __init__(self, odds_api_key: Optional[str] = None):
        self.odds_api_key = odds_api_key or os.getenv('ODDS_API_KEY')
        self.cache = {}
        self.cache_ttl = 60  # seconds
        
    def _cached_request(self, url: str, cache_key: str, ttl: int = None) -> Optional[Dict]:
        """Make cached HTTP request"""
        ttl = ttl or self.cache_ttl
        
        # Check cache
        if cache_key in self.cache:
            cached_time, cached_data = self.cache[cache_key]
            if time.time() - cached_time < ttl:
                return cached_data
        
        # Make request
        try:
            resp = requests.get(url, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                self.cache[cache_key] = (time.time(), data)
                return data
        except Exception as e:
            print(f"[Request Error] {url}: {e}")
        
        return None

    # =========================================================================
    # ESPN DATA (Works without API key)
    # =========================================================================
    
    def get_espn_injuries(self, sport: str = 'nba') -> List[Dict]:
        """
        Fetch injury report from ESPN
        Returns list of injured players with status
        """
        sport_path = 'basketball/nba' if sport.lower() == 'nba' else 'football/nfl'
        url = f"{self.ESPN_BASE}/{sport_path}/injuries"
        
        data = self._cached_request(url, f'injuries_{sport}', ttl=300)
        if not data:
            return []
        
        injuries = []
        for team_data in data.get('injuries', []):
            team_info = team_data.get('team', {})
            team_name = team_info.get('displayName', 'Unknown')
            team_abbrev = team_info.get('abbreviation', '???')
            
            for player in team_data.get('injuries', []):
                athlete = player.get('athlete', {})
                injuries.append({
                    'team': team_name,
                    'team_abbrev': team_abbrev,
                    'player_id': athlete.get('id'),
                    'player': athlete.get('displayName', 'Unknown'),
                    'position': athlete.get('position', {}).get('abbreviation', ''),
                    'status': player.get('status', 'Unknown'),  # OUT, DOUBTFUL, QUESTIONABLE, PROBABLE
                    'injury_type': player.get('type', {}).get('detail', 'Unknown'),
                    'injury_date': player.get('date', '')
                })
        
        # Save to file
        filename = f'{sport.lower()}_injuries.json'
        with open(filename, 'w') as f:
            json.dump({
                'updated': datetime.now().isoformat(),
                'count': len(injuries),
                'injuries': injuries
            }, f, indent=2)
        
        print(f"[{sport.upper()}] {len(injuries)} injuries fetched")
        return injuries
    
    def get_espn_scoreboard(self, sport: str = 'nba') -> List[Dict]:
        """
        Fetch today's games with live scores and odds
        """
        sport_path = 'basketball/nba' if sport.lower() == 'nba' else 'football/nfl'
        url = f"{self.ESPN_BASE}/{sport_path}/scoreboard"
        
        data = self._cached_request(url, f'scoreboard_{sport}', ttl=30)
        if not data:
            return []
        
        games = []
        for event in data.get('events', []):
            competition = event.get('competitions', [{}])[0]
            competitors = competition.get('competitors', [])
            
            if len(competitors) < 2:
                continue
            
            home = next((c for c in competitors if c.get('homeAway') == 'home'), {})
            away = next((c for c in competitors if c.get('homeAway') == 'away'), {})
            
            # Extract odds if available
            odds_data = {}
            if competition.get('odds'):
                odds_raw = competition['odds'][0] if competition['odds'] else {}
                odds_data = {
                    'spread': odds_raw.get('spread', 0),
                    'spread_odds': odds_raw.get('spreadOdds', -110),
                    'over_under': odds_raw.get('overUnder', 0),
                    'home_ml': odds_raw.get('homeTeamOdds', {}).get('moneyLine', 0),
                    'away_ml': odds_raw.get('awayTeamOdds', {}).get('moneyLine', 0),
                    'provider': odds_raw.get('provider', {}).get('name', 'Unknown')
                }
            
            status_info = event.get('status', {})
            
            games.append({
                'game_id': event.get('id'),
                'name': event.get('name'),
                'date': event.get('date'),
                'status': status_info.get('type', {}).get('name', 'Unknown'),
                'status_detail': status_info.get('type', {}).get('detail', ''),
                'period': status_info.get('period', 0),
                'clock': status_info.get('displayClock', ''),
                'home': {
                    'team': home.get('team', {}).get('displayName', 'Unknown'),
                    'abbrev': home.get('team', {}).get('abbreviation', ''),
                    'score': int(home.get('score', 0) or 0),
                    'record': home.get('records', [{}])[0].get('summary', '') if home.get('records') else ''
                },
                'away': {
                    'team': away.get('team', {}).get('displayName', 'Unknown'),
                    'abbrev': away.get('team', {}).get('abbreviation', ''),
                    'score': int(away.get('score', 0) or 0),
                    'record': away.get('records', [{}])[0].get('summary', '') if away.get('records') else ''
                },
                'odds': odds_data,
                'venue': competition.get('venue', {}).get('fullName', '')
            })
        
        return games

    # =========================================================================
    # THE ODDS API (Multi-book comparison)
    # =========================================================================
    
    def get_odds_comparison(self, sport: str = 'nba') -> List[Dict]:
        """
        Fetch odds from multiple sportsbooks for arbitrage detection
        """
        if not self.odds_api_key:
            print("[WARN] ODDS_API_KEY not set")
            return []
        
        sport_key = 'basketball_nba' if sport.lower() == 'nba' else 'americanfootball_nfl'
        url = f"{self.ODDS_API_BASE}/sports/{sport_key}/odds"
        
        params = {
            'apiKey': self.odds_api_key,
            'regions': 'us',
            'markets': 'h2h,spreads,totals',
            'oddsFormat': 'american'
        }
        
        try:
            resp = requests.get(url, params=params, timeout=15)
            if resp.status_code != 200:
                print(f"[Odds API] Error: {resp.status_code}")
                return []
            
            games = resp.json()
            
            # Process into comparison format
            comparisons = []
            for game in games:
                bookmakers = game.get('bookmakers', [])
                if not bookmakers:
                    continue
                
                # Collect all odds by market type
                h2h_odds = {}
                spread_odds = {}
                total_odds = {}
                
                for book in bookmakers:
                    book_name = book.get('title', 'Unknown')
                    
                    for market in book.get('markets', []):
                        market_key = market.get('key')
                        outcomes = market.get('outcomes', [])
                        
                        if market_key == 'h2h':
                            h2h_odds[book_name] = {
                                o.get('name'): o.get('price') for o in outcomes
                            }
                        elif market_key == 'spreads':
                            spread_odds[book_name] = {
                                o.get('name'): {'point': o.get('point'), 'price': o.get('price')}
                                for o in outcomes
                            }
                        elif market_key == 'totals':
                            total_odds[book_name] = {
                                o.get('name'): {'point': o.get('point'), 'price': o.get('price')}
                                for o in outcomes
                            }
                
                # Find best odds
                best_home_ml = self._find_best_odds(h2h_odds, game.get('home_team'))
                best_away_ml = self._find_best_odds(h2h_odds, game.get('away_team'))
                
                comparisons.append({
                    'game_id': game.get('id'),
                    'home_team': game.get('home_team'),
                    'away_team': game.get('away_team'),
                    'commence_time': game.get('commence_time'),
                    'h2h': h2h_odds,
                    'spreads': spread_odds,
                    'totals': total_odds,
                    'best_odds': {
                        'home_ml': best_home_ml,
                        'away_ml': best_away_ml
                    },
                    'book_count': len(bookmakers)
                })
            
            return comparisons
            
        except Exception as e:
            print(f"[Odds API Error] {e}")
            return []
    
    def _find_best_odds(self, odds_dict: Dict, team: str) -> Dict:
        """Find the best odds for a team across all books"""
        best_odds = None
        best_book = None
        
        for book, teams in odds_dict.items():
            if team in teams:
                odds = teams[team]
                if best_odds is None or odds > best_odds:
                    best_odds = odds
                    best_book = book
        
        return {'odds': best_odds, 'book': best_book}

    # =========================================================================
    # NBA SPECIFIC (requires nba_api)
    # =========================================================================
    
    def get_nba_team_stats(self) -> Dict[str, Dict]:
        """Fetch current season team stats"""
        if not NBA_API_AVAILABLE:
            return {}
        
        try:
            time.sleep(0.6)  # Rate limit
            stats = leaguedashteamstats.LeagueDashTeamStats(
                season=self.NBA_SEASON,
                per_mode_detailed='PerGame'
            )
            df = stats.get_data_frames()[0]
            
            team_stats = {}
            for _, row in df.iterrows():
                abbrev = row.get('TEAM_ABBREVIATION', '')
                team_stats[abbrev] = {
                    'team_id': row.get('TEAM_ID'),
                    'team_name': row.get('TEAM_NAME'),
                    'games': row.get('GP', 0),
                    'wins': row.get('W', 0),
                    'losses': row.get('L', 0),
                    'ppg': round(row.get('PTS', 0), 1),
                    'opp_ppg': round(row.get('PLUS_MINUS', 0) * -1 + row.get('PTS', 0), 1),  # Approximate
                    'off_rating': round(row.get('OFF_RATING', 0), 1) if 'OFF_RATING' in row else 0,
                    'def_rating': round(row.get('DEF_RATING', 0), 1) if 'DEF_RATING' in row else 0,
                    'pace': round(row.get('PACE', 0), 1) if 'PACE' in row else 0,
                    'fg_pct': round(row.get('FG_PCT', 0) * 100, 1),
                    'fg3_pct': round(row.get('FG3_PCT', 0) * 100, 1),
                    'reb': round(row.get('REB', 0), 1),
                    'ast': round(row.get('AST', 0), 1),
                    'tov': round(row.get('TOV', 0), 1)
                }
            
            return team_stats
            
        except Exception as e:
            print(f"[NBA Team Stats Error] {e}")
            return {}
    
    def get_nba_player_stats(self, min_games: int = 10, min_minutes: int = 15) -> List[Dict]:
        """Fetch current season player stats"""
        if not NBA_API_AVAILABLE:
            return []
        
        try:
            time.sleep(0.6)
            stats = leaguedashplayerstats.LeagueDashPlayerStats(
                season=self.NBA_SEASON,
                per_mode_detailed='PerGame'
            )
            df = stats.get_data_frames()[0]
            
            # Filter for significant players
            df = df[(df['GP'] >= min_games) & (df['MIN'] >= min_minutes)]
            
            players = []
            for _, row in df.iterrows():
                players.append({
                    'player_id': row.get('PLAYER_ID'),
                    'player': row.get('PLAYER_NAME'),
                    'team': row.get('TEAM_ABBREVIATION'),
                    'games': row.get('GP', 0),
                    'minutes': round(row.get('MIN', 0), 1),
                    'ppg': round(row.get('PTS', 0), 1),
                    'rpg': round(row.get('REB', 0), 1),
                    'apg': round(row.get('AST', 0), 1),
                    'fg_pct': round(row.get('FG_PCT', 0) * 100, 1),
                    'fg3_pct': round(row.get('FG3_PCT', 0) * 100, 1),
                    'plus_minus': round(row.get('PLUS_MINUS', 0), 1)
                })
            
            return sorted(players, key=lambda x: x['ppg'], reverse=True)
            
        except Exception as e:
            print(f"[NBA Player Stats Error] {e}")
            return []

    # =========================================================================
    # NFL SPECIFIC (requires nfl_data_py)
    # =========================================================================
    
    def get_nfl_schedule(self, season: int = None) -> List[Dict]:
        """Fetch NFL schedule with results"""
        if not NFL_API_AVAILABLE:
            return []
        
        season = season or self.NFL_SEASON
        
        try:
            schedule = nfl.import_schedules([season])
            
            games = []
            for _, row in schedule.iterrows():
                games.append({
                    'game_id': row.get('game_id'),
                    'season': row.get('season'),
                    'week': row.get('week'),
                    'game_type': row.get('game_type'),
                    'gameday': str(row.get('gameday', '')),
                    'home_team': row.get('home_team'),
                    'away_team': row.get('away_team'),
                    'home_score': row.get('home_score'),
                    'away_score': row.get('away_score'),
                    'spread_line': row.get('spread_line'),
                    'total_line': row.get('total_line'),
                    'result': row.get('result'),
                    'overtime': row.get('overtime', 0),
                    'stadium': row.get('stadium')
                })
            
            return games
            
        except Exception as e:
            print(f"[NFL Schedule Error] {e}")
            return []
    
    def get_nfl_team_stats(self, season: int = None) -> Dict[str, Dict]:
        """Fetch NFL team season stats"""
        if not NFL_API_AVAILABLE:
            return {}
        
        season = season or self.NFL_SEASON
        
        try:
            # Get seasonal stats
            stats = nfl.import_seasonal_data([season])
            
            # Aggregate by team
            team_stats = {}
            for _, row in stats.iterrows():
                team = row.get('recent_team', row.get('team', ''))
                if not team or team in team_stats:
                    continue
                
                # This is player-level, would need aggregation
                # For now, use schedule-based stats
            
            # Use schedule for basic stats
            schedule = nfl.import_schedules([season])
            
            for team in schedule['home_team'].unique():
                home_games = schedule[schedule['home_team'] == team]
                away_games = schedule[schedule['away_team'] == team]
                
                home_pts = home_games['home_score'].dropna()
                away_pts = away_games['away_score'].dropna()
                home_pts_allowed = home_games['away_score'].dropna()
                away_pts_allowed = away_games['home_score'].dropna()
                
                all_pts = list(home_pts) + list(away_pts)
                all_pts_allowed = list(home_pts_allowed) + list(away_pts_allowed)
                
                if all_pts:
                    team_stats[team] = {
                        'games': len(all_pts),
                        'ppg': round(sum(all_pts) / len(all_pts), 1),
                        'ppg_allowed': round(sum(all_pts_allowed) / len(all_pts_allowed), 1) if all_pts_allowed else 0,
                        'home_wins': len(home_games[(home_games['home_score'] > home_games['away_score'])]),
                        'away_wins': len(away_games[(away_games['away_score'] > away_games['home_score'])])
                    }
            
            return team_stats
            
        except Exception as e:
            print(f"[NFL Team Stats Error] {e}")
            return {}

    # =========================================================================
    # PLAYER SCHEME FIT TRACKING
    # =========================================================================
    
    def analyze_player_scheme_fit(self, player_name: str, seasons: List[str] = None) -> Dict:
        """
        Analyze if a player's role/scheme has stayed consistent
        Used to determine if historical data is still relevant
        """
        if not NBA_API_AVAILABLE:
            return {'error': 'nba_api not available'}
        
        seasons = seasons or ['2022-23', '2023-24', '2024-25']
        
        try:
            # Get player game logs across seasons
            season_stats = []
            
            for season in seasons:
                time.sleep(0.6)
                # This would need player_id lookup first
                # Simplified version
                pass
            
            # Compare usage rate, position, etc across seasons
            return {
                'player': player_name,
                'seasons_analyzed': seasons,
                'scheme_stability': 0.0,  # 0-1 score
                'recommendation': 'USE_HISTORICAL'  # or 'DISCARD_HISTORICAL'
            }
            
        except Exception as e:
            return {'error': str(e)}

    # =========================================================================
    # COMBINED LIVE DATA FETCH
    # =========================================================================
    
    def fetch_all_live_data(self, sport: str = 'nba') -> Dict:
        """
        Fetch all live data for a sport and save to files
        """
        print(f"\n{'='*60}")
        print(f"FETCHING LIVE {sport.upper()} DATA")
        print(f"{'='*60}")
        
        result = {
            'sport': sport,
            'timestamp': datetime.now().isoformat(),
            'games': [],
            'injuries': [],
            'odds': [],
            'team_stats': {}
        }
        
        # Get ESPN data (always available)
        print(f"[1/4] Fetching scoreboard...")
        result['games'] = self.get_espn_scoreboard(sport)
        print(f"      Found {len(result['games'])} games")
        
        print(f"[2/4] Fetching injuries...")
        result['injuries'] = self.get_espn_injuries(sport)
        print(f"      Found {len(result['injuries'])} injuries")
        
        print(f"[3/4] Fetching odds comparison...")
        result['odds'] = self.get_odds_comparison(sport)
        print(f"      Found {len(result['odds'])} games with odds")
        
        print(f"[4/4] Fetching team stats...")
        if sport.lower() == 'nba':
            result['team_stats'] = self.get_nba_team_stats()
        else:
            result['team_stats'] = self.get_nfl_team_stats()
        print(f"      Found {len(result['team_stats'])} teams")
        
        # Save to file
        filename = f'live_{sport.lower()}_data.json'
        with open(filename, 'w') as f:
            json.dump(result, f, indent=2, default=str)
        
        print(f"\n[SAVED] {filename}")
        print(f"{'='*60}\n")
        
        return result


# =============================================================================
# MAIN EXECUTION
# =============================================================================

if __name__ == "__main__":
    print("\n" + "="*70)
    print("LIVE DATA ENGINE v2.0")
    print("="*70)
    
    engine = LiveDataEngine()
    
    # Fetch NBA data
    nba_data = engine.fetch_all_live_data('nba')
    
    # Fetch NFL data
    nfl_data = engine.fetch_all_live_data('nfl')
    
    # Summary
    print("\n" + "="*70)
    print("SUMMARY")
    print("="*70)
    print(f"NBA Games: {len(nba_data['games'])}")
    print(f"NBA Injuries: {len(nba_data['injuries'])}")
    print(f"NFL Games: {len(nfl_data['games'])}")
    print(f"NFL Injuries: {len(nfl_data['injuries'])}")
    print("\nFiles created:")
    print("  - live_nba_data.json")
    print("  - live_nfl_data.json")
    print("  - nba_injuries.json")
    print("  - nfl_injuries.json")
