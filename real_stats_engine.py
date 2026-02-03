#!/usr/bin/env python3
"""
================================================================================
REAL STATS ENGINE v1.0
Fetches actual NBA team/player statistics for accurate edge detection
================================================================================

Data Sources:
- nba_api: Official NBA stats (offensive/defensive ratings, pace, etc.)
- ESPN API: Backup for team stats

================================================================================
"""

import json
import os
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import requests

# Try to import nba_api
try:
    from nba_api.stats.endpoints import (
        leaguedashteamstats,
        teamgamelog,
        leaguegamefinder
    )
    from nba_api.stats.static import teams as nba_teams_static
    NBA_API_AVAILABLE = True
except ImportError:
    NBA_API_AVAILABLE = False
    print("[WARN] nba_api not installed. Install: pip install nba_api")


class RealStatsEngine:
    """
    Fetches and caches real NBA statistics
    """
    
    CURRENT_SEASON = '2024-25'
    
    # Team abbreviation mapping
    TEAM_MAP = {
        'ATL': 'Atlanta Hawks', 'BOS': 'Boston Celtics', 'BKN': 'Brooklyn Nets',
        'CHA': 'Charlotte Hornets', 'CHI': 'Chicago Bulls', 'CLE': 'Cleveland Cavaliers',
        'DAL': 'Dallas Mavericks', 'DEN': 'Denver Nuggets', 'DET': 'Detroit Pistons',
        'GSW': 'Golden State Warriors', 'HOU': 'Houston Rockets', 'IND': 'Indiana Pacers',
        'LAC': 'Los Angeles Clippers', 'LAL': 'Los Angeles Lakers', 'MEM': 'Memphis Grizzlies',
        'MIA': 'Miami Heat', 'MIL': 'Milwaukee Bucks', 'MIN': 'Minnesota Timberwolves',
        'NOP': 'New Orleans Pelicans', 'NYK': 'New York Knicks', 'OKC': 'Oklahoma City Thunder',
        'ORL': 'Orlando Magic', 'PHI': 'Philadelphia 76ers', 'PHX': 'Phoenix Suns',
        'POR': 'Portland Trail Blazers', 'SAC': 'Sacramento Kings', 'SAS': 'San Antonio Spurs',
        'TOR': 'Toronto Raptors', 'UTA': 'Utah Jazz', 'WAS': 'Washington Wizards'
    }
    
    NAME_TO_ABBREV = {v: k for k, v in TEAM_MAP.items()}
    
    # NBA API Team IDs
    TEAM_IDS = {}
    
    def __init__(self, cache_file: str = 'team_stats_cache.json'):
        self.cache_file = cache_file
        self.cache = {}
        self.cache_timestamp = None
        self.load_cache()
        self._load_team_ids()
    
    def _load_team_ids(self):
        """Load NBA team IDs"""
        if NBA_API_AVAILABLE:
            try:
                teams = nba_teams_static.get_teams()
                for team in teams:
                    abbrev = team.get('abbreviation', '')
                    self.TEAM_IDS[abbrev] = team.get('id')
            except:
                pass
    
    def load_cache(self):
        if os.path.exists(self.cache_file):
            try:
                with open(self.cache_file, 'r') as f:
                    data = json.load(f)
                    self.cache = data.get('stats', {})
                    self.cache_timestamp = data.get('timestamp')
            except:
                self.cache = {}
    
    def save_cache(self):
        with open(self.cache_file, 'w') as f:
            json.dump({
                'timestamp': datetime.now().isoformat(),
                'stats': self.cache
            }, f, indent=2)

    def fetch_all_team_stats(self, force_refresh: bool = False) -> Dict[str, Dict]:
        """
        Fetch all team stats - tries NBA API first, falls back to ESPN
        """
        # Check cache
        if not force_refresh and self.cache and self._is_cache_fresh():
            print(f"[Stats] Using cached data ({len(self.cache)} teams)")
            return self.cache
        
        # Try NBA API
        stats = self._fetch_nba_api_stats()
        
        # Fallback to ESPN if needed
        if not stats:
            stats = self._fetch_espn_stats()
        
        if stats:
            self.cache = stats
            self.cache_timestamp = datetime.now().isoformat()
            self.save_cache()
        
        return stats
    
    def _is_cache_fresh(self, max_hours: int = 6) -> bool:
        if not self.cache_timestamp:
            return False
        try:
            cache_time = datetime.fromisoformat(self.cache_timestamp)
            return (datetime.now() - cache_time).total_seconds() < max_hours * 3600
        except:
            return False

    def _fetch_nba_api_stats(self) -> Dict[str, Dict]:
        """Fetch from official NBA API"""
        if not NBA_API_AVAILABLE:
            return {}
        
        print("[Stats] Fetching from NBA API...")
        
        try:
            time.sleep(0.6)  # Rate limit
            
            # Basic stats
            basic = leaguedashteamstats.LeagueDashTeamStats(
                season=self.CURRENT_SEASON,
                per_mode_detailed='PerGame'
            )
            basic_df = basic.get_data_frames()[0]
            
            time.sleep(0.6)
            
            # Advanced stats (for ratings)
            advanced = leaguedashteamstats.LeagueDashTeamStats(
                season=self.CURRENT_SEASON,
                measure_type_detailed_defense='Advanced',
                per_mode_detailed='PerGame'
            )
            adv_df = advanced.get_data_frames()[0]
            
            # Merge data
            team_stats = {}
            
            for _, row in basic_df.iterrows():
                team_name = row.get('TEAM_NAME', '')
                abbrev = self._get_abbrev(team_name)
                
                if not abbrev:
                    continue
                
                # Find advanced stats for this team
                adv_row = adv_df[adv_df['TEAM_NAME'] == team_name]
                
                off_rating = 110.0
                def_rating = 110.0
                net_rating = 0.0
                pace = 100.0
                
                if len(adv_row) > 0:
                    adv = adv_row.iloc[0]
                    off_rating = float(adv.get('OFF_RATING', 110))
                    def_rating = float(adv.get('DEF_RATING', 110))
                    net_rating = float(adv.get('NET_RATING', 0))
                    pace = float(adv.get('PACE', 100))
                
                team_stats[abbrev] = {
                    'team_name': team_name,
                    'games': int(row.get('GP', 0)),
                    'wins': int(row.get('W', 0)),
                    'losses': int(row.get('L', 0)),
                    'win_pct': round(float(row.get('W_PCT', 0.5)), 3),
                    'ppg': round(float(row.get('PTS', 110)), 1),
                    'off_rating': round(off_rating, 1),
                    'def_rating': round(def_rating, 1),
                    'net_rating': round(net_rating, 1),
                    'pace': round(pace, 1),
                    'fg_pct': round(float(row.get('FG_PCT', 0.45)) * 100, 1),
                    'fg3_pct': round(float(row.get('FG3_PCT', 0.35)) * 100, 1),
                    'reb': round(float(row.get('REB', 44)), 1),
                    'ast': round(float(row.get('AST', 25)), 1),
                    'tov': round(float(row.get('TOV', 14)), 1)
                }
            
            print(f"[Stats] Fetched {len(team_stats)} teams from NBA API")
            return team_stats
            
        except Exception as e:
            print(f"[Stats] NBA API error: {e}")
            return {}
    
    def _fetch_espn_stats(self) -> Dict[str, Dict]:
        """Fallback: Fetch from ESPN API"""
        print("[Stats] Fetching from ESPN API...")
        
        try:
            # ESPN team stats endpoint
            url = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams"
            r = requests.get(url, timeout=10)
            data = r.json()
            
            team_stats = {}
            
            for team in data.get('sports', [{}])[0].get('leagues', [{}])[0].get('teams', []):
                team_info = team.get('team', {})
                abbrev = team_info.get('abbreviation', '')
                
                if not abbrev:
                    continue
                
                # ESPN doesn't give advanced stats, use estimates
                record = team_info.get('record', {}).get('items', [{}])
                wins = 0
                losses = 0
                
                for rec in record:
                    if rec.get('type') == 'total':
                        summary = rec.get('summary', '0-0')
                        parts = summary.split('-')
                        if len(parts) == 2:
                            wins = int(parts[0])
                            losses = int(parts[1])
                
                games = wins + losses
                win_pct = wins / games if games > 0 else 0.5
                
                # Estimate ratings from win%
                # Elite team (~70% win) ≈ +8 net rating
                # Average team (50%) ≈ 0 net rating
                estimated_net = (win_pct - 0.5) * 20
                
                team_stats[abbrev] = {
                    'team_name': team_info.get('displayName', ''),
                    'games': games,
                    'wins': wins,
                    'losses': losses,
                    'win_pct': round(win_pct, 3),
                    'ppg': 112.0,  # League average estimate
                    'off_rating': round(112 + estimated_net / 2, 1),
                    'def_rating': round(112 - estimated_net / 2, 1),
                    'net_rating': round(estimated_net, 1),
                    'pace': 100.0,
                    'fg_pct': 46.0,
                    'fg3_pct': 36.0,
                    'reb': 44.0,
                    'ast': 25.0,
                    'tov': 14.0
                }
            
            print(f"[Stats] Fetched {len(team_stats)} teams from ESPN")
            return team_stats
            
        except Exception as e:
            print(f"[Stats] ESPN error: {e}")
            return {}
    
    def _get_abbrev(self, team_name: str) -> str:
        """Get team abbreviation from name"""
        # Direct match
        if team_name in self.NAME_TO_ABBREV:
            return self.NAME_TO_ABBREV[team_name]
        
        # Partial match
        for name, abbrev in self.NAME_TO_ABBREV.items():
            if team_name in name or name in team_name:
                return abbrev
        
        return ''

    def fetch_team_recent_games(self, team_abbrev: str, num_games: int = 10) -> List[Dict]:
        """
        Fetch recent games for a team to calculate L10 form
        """
        if not NBA_API_AVAILABLE:
            return []
        
        team_id = self.TEAM_IDS.get(team_abbrev)
        if not team_id:
            return []
        
        try:
            time.sleep(0.6)
            
            gamelog = teamgamelog.TeamGameLog(
                team_id=team_id,
                season=self.CURRENT_SEASON
            )
            df = gamelog.get_data_frames()[0]
            
            games = []
            for _, row in df.head(num_games).iterrows():
                games.append({
                    'date': row.get('GAME_DATE', ''),
                    'matchup': row.get('MATCHUP', ''),
                    'result': row.get('WL', ''),
                    'pts': int(row.get('PTS', 0)),
                    'opp_pts': int(row.get('PTS', 0)) - int(row.get('PLUS_MINUS', 0)),
                    'plus_minus': int(row.get('PLUS_MINUS', 0))
                })
            
            return games
            
        except Exception as e:
            print(f"[Stats] Game log error for {team_abbrev}: {e}")
            return []
    
    def calculate_recent_form(self, team_abbrev: str, num_games: int = 10) -> Dict:
        """
        Calculate team's recent form (L5, L10 stats)
        """
        games = self.fetch_team_recent_games(team_abbrev, num_games)
        
        if not games:
            return {
                'l5_wins': 2.5,
                'l5_win_pct': 0.5,
                'l10_wins': 5,
                'l10_win_pct': 0.5,
                'l10_net_rating': 0,
                'l10_ppg': 112,
                'streak': 0
            }
        
        l5 = games[:5]
        l10 = games[:10]
        
        l5_wins = sum(1 for g in l5 if g['result'] == 'W')
        l10_wins = sum(1 for g in l10 if g['result'] == 'W')
        
        l10_plus_minus = sum(g['plus_minus'] for g in l10)
        l10_ppg = sum(g['pts'] for g in l10) / len(l10) if l10 else 112
        
        # Calculate streak
        streak = 0
        if games:
            current = games[0]['result']
            for g in games:
                if g['result'] == current:
                    streak += 1 if current == 'W' else -1
                else:
                    break
        
        return {
            'l5_wins': l5_wins,
            'l5_win_pct': l5_wins / 5 if len(l5) >= 5 else l5_wins / len(l5) if l5 else 0.5,
            'l10_wins': l10_wins,
            'l10_win_pct': l10_wins / 10 if len(l10) >= 10 else l10_wins / len(l10) if l10 else 0.5,
            'l10_net_rating': round(l10_plus_minus / len(l10), 1) if l10 else 0,
            'l10_ppg': round(l10_ppg, 1),
            'streak': streak
        }
    
    def get_team_full_profile(self, team_abbrev: str) -> Dict:
        """
        Get complete team profile with season stats + recent form
        """
        # Get season stats
        all_stats = self.fetch_all_team_stats()
        team_stats = all_stats.get(team_abbrev, {})
        
        if not team_stats:
            return {'error': f'Team {team_abbrev} not found'}
        
        # Get recent form
        recent = self.calculate_recent_form(team_abbrev)
        
        return {
            **team_stats,
            **recent,
            'abbrev': team_abbrev
        }
    
    def get_matchup_data(self, home_team: str, away_team: str) -> Dict:
        """
        Get all data needed for edge detection on a matchup
        """
        home_profile = self.get_team_full_profile(home_team)
        away_profile = self.get_team_full_profile(away_team)
        
        return {
            'home': home_profile,
            'away': away_profile,
            'pace_diff': abs(home_profile.get('pace', 100) - away_profile.get('pace', 100)),
            'net_rating_diff': home_profile.get('net_rating', 0) - away_profile.get('net_rating', 0),
            'form_diff': home_profile.get('l10_win_pct', 0.5) - away_profile.get('l10_win_pct', 0.5)
        }


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    print("\n" + "="*70)
    print("REAL STATS ENGINE v1.0")
    print("="*70)
    
    engine = RealStatsEngine()
    
    # Fetch all team stats
    print("\n[Fetching Team Stats]")
    stats = engine.fetch_all_team_stats(force_refresh=True)
    
    if stats:
        print(f"\nLoaded {len(stats)} teams\n")
        
        # Show top 5 teams by net rating
        sorted_teams = sorted(stats.items(), key=lambda x: x[1].get('net_rating', 0), reverse=True)
        
        print("Top 5 Teams by Net Rating:")
        print("-" * 60)
        for abbrev, data in sorted_teams[:5]:
            print(f"  {abbrev}: OFF {data['off_rating']:.1f} | DEF {data['def_rating']:.1f} | NET {data['net_rating']:+.1f} | PACE {data['pace']:.1f}")
        
        print("\nBottom 5 Teams by Net Rating:")
        print("-" * 60)
        for abbrev, data in sorted_teams[-5:]:
            print(f"  {abbrev}: OFF {data['off_rating']:.1f} | DEF {data['def_rating']:.1f} | NET {data['net_rating']:+.1f} | PACE {data['pace']:.1f}")
        
        # Test matchup
        print("\n" + "="*70)
        print("Sample Matchup: BOS vs MIA")
        print("="*70)
        
        matchup = engine.get_matchup_data('BOS', 'MIA')
        
        print(f"\nBoston Celtics:")
        home = matchup['home']
        print(f"  Season: {home.get('wins', 0)}-{home.get('losses', 0)} ({home.get('win_pct', 0):.3f})")
        print(f"  Ratings: OFF {home.get('off_rating', 0):.1f} | DEF {home.get('def_rating', 0):.1f} | NET {home.get('net_rating', 0):+.1f}")
        print(f"  L10: {home.get('l10_wins', 0)} wins | Net: {home.get('l10_net_rating', 0):+.1f}")
        
        print(f"\nMiami Heat:")
        away = matchup['away']
        print(f"  Season: {away.get('wins', 0)}-{away.get('losses', 0)} ({away.get('win_pct', 0):.3f})")
        print(f"  Ratings: OFF {away.get('off_rating', 0):.1f} | DEF {away.get('def_rating', 0):.1f} | NET {away.get('net_rating', 0):+.1f}")
        print(f"  L10: {away.get('l10_wins', 0)} wins | Net: {away.get('l10_net_rating', 0):+.1f}")
        
        print(f"\nMatchup Edge:")
        print(f"  Net Rating Diff: {matchup['net_rating_diff']:+.1f}")
        print(f"  Pace Diff: {matchup['pace_diff']:.1f}")
        print(f"  Form Diff: {matchup['form_diff']:+.3f}")
    
    print("\n" + "="*70)
