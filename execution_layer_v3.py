#!/usr/bin/env python3
"""
================================================================================
EXECUTION LAYER v3.0
Enhanced with Line Movement Tracking & Sharp Money Detection
================================================================================

NEW FEATURES:
- Line movement velocity tracking
- Steam move detection
- Reverse line movement alerts
- Book disagreement analysis
- Historical line snapshots

================================================================================
"""

import json
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except:
    pass


class LineTracker:
    """
    Tracks line movements over time for sharp money detection
    """
    
    def __init__(self, history_file: str = 'line_history.json'):
        self.history_file = history_file
        self.history = {}  # game_id -> list of snapshots
        self.load()
    
    def load(self):
        if os.path.exists(self.history_file):
            try:
                with open(self.history_file, 'r') as f:
                    self.history = json.load(f)
            except:
                self.history = {}
    
    def save(self):
        with open(self.history_file, 'w') as f:
            json.dump(self.history, f, indent=2, default=str)
    
    def record_snapshot(self, game_id: str, spread: float, total: float, 
                        home_ml: int, away_ml: int, book_spreads: Dict[str, float]):
        """Record a point-in-time snapshot of odds"""
        
        if game_id not in self.history:
            self.history[game_id] = []
        
        self.history[game_id].append({
            'timestamp': datetime.now().isoformat(),
            'spread': spread,
            'total': total,
            'home_ml': home_ml,
            'away_ml': away_ml,
            'book_spreads': book_spreads
        })
        
        # Keep last 50 snapshots per game
        if len(self.history[game_id]) > 50:
            self.history[game_id] = self.history[game_id][-50:]
    
    def get_opening_line(self, game_id: str) -> Optional[Dict]:
        """Get the first recorded line for a game"""
        if game_id in self.history and self.history[game_id]:
            return self.history[game_id][0]
        return None
    
    def get_current_line(self, game_id: str) -> Optional[Dict]:
        """Get the most recent line"""
        if game_id in self.history and self.history[game_id]:
            return self.history[game_id][-1]
        return None
    
    def calculate_movement(self, game_id: str) -> Dict:
        """Calculate total line movement from open to current"""
        opening = self.get_opening_line(game_id)
        current = self.get_current_line(game_id)
        
        if not opening or not current:
            return {'spread_move': 0, 'total_move': 0, 'hours_tracked': 0}
        
        try:
            t_open = datetime.fromisoformat(opening['timestamp'])
            t_now = datetime.fromisoformat(current['timestamp'])
            hours = (t_now - t_open).total_seconds() / 3600
        except:
            hours = 0
        
        return {
            'spread_open': opening['spread'],
            'spread_current': current['spread'],
            'spread_move': current['spread'] - opening['spread'],
            'total_open': opening['total'],
            'total_current': current['total'],
            'total_move': current['total'] - opening['total'],
            'hours_tracked': round(hours, 1)
        }
    
    def calculate_velocity(self, game_id: str, window_hours: float = 1.0) -> Dict:
        """
        Calculate line movement velocity (points per hour)
        High velocity = sharp money
        """
        if game_id not in self.history:
            return {'spread_velocity': 0, 'is_sharp': False}
        
        snapshots = self.history[game_id]
        if len(snapshots) < 2:
            return {'spread_velocity': 0, 'is_sharp': False}
        
        # Look at recent window
        now = datetime.now()
        cutoff = now - timedelta(hours=window_hours)
        
        recent = []
        for snap in snapshots:
            try:
                t = datetime.fromisoformat(snap['timestamp'])
                if t >= cutoff:
                    recent.append(snap)
            except:
                continue
        
        if len(recent) < 2:
            return {'spread_velocity': 0, 'is_sharp': False}
        
        first = recent[0]
        last = recent[-1]
        
        try:
            t1 = datetime.fromisoformat(first['timestamp'])
            t2 = datetime.fromisoformat(last['timestamp'])
            hours = (t2 - t1).total_seconds() / 3600
            
            if hours < 0.05:  # Less than 3 minutes
                return {'spread_velocity': 0, 'is_sharp': False}
            
            spread_change = abs(last['spread'] - first['spread'])
            velocity = spread_change / hours
            
            return {
                'spread_velocity': round(velocity, 2),
                'is_sharp': velocity > 0.5,  # More than 0.5 pts/hour = sharp
                'direction': 'toward_home' if last['spread'] < first['spread'] else 'toward_away'
            }
        except:
            return {'spread_velocity': 0, 'is_sharp': False}
    
    def detect_steam_move(self, game_id: str, threshold_pts: float = 0.5, 
                          threshold_minutes: int = 10) -> Dict:
        """
        Detect steam move: rapid coordinated line movement
        
        Steam move = multiple books move line in same direction within minutes
        This indicates syndicate/sharp action
        """
        if game_id not in self.history:
            return {'detected': False}
        
        snapshots = self.history[game_id]
        if len(snapshots) < 2:
            return {'detected': False}
        
        # Check last two snapshots
        prev = snapshots[-2]
        curr = snapshots[-1]
        
        try:
            t1 = datetime.fromisoformat(prev['timestamp'])
            t2 = datetime.fromisoformat(curr['timestamp'])
            minutes = (t2 - t1).total_seconds() / 60
            
            if minutes > threshold_minutes:
                return {'detected': False}
            
            spread_change = abs(curr['spread'] - prev['spread'])
            
            if spread_change >= threshold_pts:
                # Check if multiple books moved together
                prev_books = prev.get('book_spreads', {})
                curr_books = curr.get('book_spreads', {})
                
                books_moved = 0
                for book in curr_books:
                    if book in prev_books:
                        if abs(curr_books[book] - prev_books[book]) >= threshold_pts * 0.5:
                            books_moved += 1
                
                return {
                    'detected': books_moved >= 2,
                    'spread_change': spread_change,
                    'minutes': round(minutes, 1),
                    'books_moved': books_moved
                }
        except:
            pass
        
        return {'detected': False}


class ExecutionLayerV3:
    """
    Enhanced execution layer with line tracking
    """
    
    ODDS_API_BASE = 'https://api.the-odds-api.com/v4'
    
    def __init__(self, odds_api_key: str = None, bankroll: float = 1000):
        self.api_key = odds_api_key or os.getenv('ODDS_API_KEY')
        self.bankroll = bankroll
        self.line_tracker = LineTracker()
        self.last_fetch = {}  # Cache timestamps
    
    def fetch_and_track_odds(self, sport: str = 'basketball_nba') -> List[Dict]:
        """
        Fetch odds and record snapshots for line tracking
        """
        if not self.api_key:
            print("[WARN] ODDS_API_KEY not set")
            return []
        
        url = f"{self.ODDS_API_BASE}/sports/{sport}/odds"
        params = {
            'apiKey': self.api_key,
            'regions': 'us',
            'markets': 'h2h,spreads,totals',
            'oddsFormat': 'american'
        }
        
        try:
            resp = requests.get(url, params=params, timeout=15)
            
            if resp.status_code == 401:
                print("[ERROR] Invalid ODDS_API_KEY")
                return []
            
            if resp.status_code != 200:
                print(f"[ERROR] Odds API: {resp.status_code}")
                return []
            
            remaining = resp.headers.get('x-requests-remaining', '?')
            print(f"[Odds API] Fetched {sport} | Quota: {remaining}")
            
            games = resp.json()
            
            # Record snapshots for each game
            for game in games:
                game_id = game.get('id', f"{game.get('away_team')}_{game.get('home_team')}")
                
                # Extract consensus odds
                spread, total, home_ml, away_ml = self._extract_consensus(game)
                book_spreads = self._extract_book_spreads(game)
                
                self.line_tracker.record_snapshot(
                    game_id=game_id,
                    spread=spread,
                    total=total,
                    home_ml=home_ml,
                    away_ml=away_ml,
                    book_spreads=book_spreads
                )
            
            self.line_tracker.save()
            return games
            
        except Exception as e:
            print(f"[ERROR] {e}")
            return []
    
    def _extract_consensus(self, game: Dict) -> Tuple[float, float, int, int]:
        """Extract consensus spread, total, and moneylines"""
        spreads = []
        totals = []
        home_mls = []
        away_mls = []
        
        for book in game.get('bookmakers', []):
            for market in book.get('markets', []):
                if market.get('key') == 'spreads':
                    for o in market.get('outcomes', []):
                        if o.get('name') == game.get('home_team'):
                            spreads.append(o.get('point', 0))
                
                elif market.get('key') == 'totals':
                    for o in market.get('outcomes', []):
                        if o.get('name') == 'Over':
                            totals.append(o.get('point', 0))
                
                elif market.get('key') == 'h2h':
                    for o in market.get('outcomes', []):
                        if o.get('name') == game.get('home_team'):
                            home_mls.append(o.get('price', -110))
                        elif o.get('name') == game.get('away_team'):
                            away_mls.append(o.get('price', -110))
        
        return (
            sum(spreads) / len(spreads) if spreads else 0,
            sum(totals) / len(totals) if totals else 220,
            int(sum(home_mls) / len(home_mls)) if home_mls else -110,
            int(sum(away_mls) / len(away_mls)) if away_mls else -110
        )
    
    def _extract_book_spreads(self, game: Dict) -> Dict[str, float]:
        """Extract spread from each book"""
        book_spreads = {}
        
        for book in game.get('bookmakers', []):
            book_name = book.get('title', 'Unknown')
            for market in book.get('markets', []):
                if market.get('key') == 'spreads':
                    for o in market.get('outcomes', []):
                        if o.get('name') == game.get('home_team'):
                            book_spreads[book_name] = o.get('point', 0)
        
        return book_spreads
    
    def get_market_analysis(self, sport: str = 'basketball_nba') -> Dict:
        """
        Comprehensive market analysis with sharp money signals
        """
        games = self.fetch_and_track_odds(sport)
        
        if not games:
            return {'error': 'No games fetched', 'games': []}
        
        analyzed_games = []
        alerts = []
        
        for game in games:
            game_id = game.get('id', f"{game.get('away_team')}_{game.get('home_team')}")
            
            # Get line movement data
            movement = self.line_tracker.calculate_movement(game_id)
            velocity = self.line_tracker.calculate_velocity(game_id)
            steam = self.line_tracker.detect_steam_move(game_id)
            
            # Find best odds
            best_odds = self._find_best_odds(game)
            
            # Check for arbitrage
            arb = self._check_arbitrage(best_odds, game)
            
            # Calculate book disagreement
            book_spreads = self._extract_book_spreads(game)
            if book_spreads:
                import numpy as np
                disagreement = np.std(list(book_spreads.values()))
            else:
                disagreement = 0
            
            analysis = {
                'game': f"{game.get('away_team')} @ {game.get('home_team')}",
                'game_id': game_id,
                'commence_time': game.get('commence_time'),
                'best_odds': best_odds,
                'line_movement': movement,
                'velocity': velocity,
                'steam_move': steam,
                'book_disagreement': round(disagreement, 2),
                'book_count': len(game.get('bookmakers', [])),
                'arbitrage': arb
            }
            
            # Generate alerts for sharp signals
            if velocity.get('is_sharp'):
                alerts.append({
                    'type': 'SHARP_MONEY',
                    'game': analysis['game'],
                    'detail': f"Line moving {velocity['spread_velocity']} pts/hr {velocity.get('direction', '')}"
                })
            
            if steam.get('detected'):
                alerts.append({
                    'type': 'STEAM_MOVE',
                    'game': analysis['game'],
                    'detail': f"{steam['spread_change']} pts in {steam['minutes']} min across {steam['books_moved']} books"
                })
            
            if disagreement > 1.0:
                alerts.append({
                    'type': 'BOOK_DISAGREEMENT',
                    'game': analysis['game'],
                    'detail': f"Spread variance: {disagreement:.1f} pts across books"
                })
            
            if arb.get('exists'):
                alerts.append({
                    'type': 'ARBITRAGE',
                    'game': analysis['game'],
                    'detail': f"{arb['profit_pct']}% guaranteed profit"
                })
            
            analyzed_games.append(analysis)
        
        return {
            'sport': sport,
            'timestamp': datetime.now().isoformat(),
            'game_count': len(analyzed_games),
            'games': analyzed_games,
            'alerts': alerts,
            'alert_count': len(alerts)
        }
    
    def _find_best_odds(self, game: Dict) -> Dict:
        """Find best odds for each market across all books"""
        best = {
            'home_ml': {'odds': -9999, 'book': None},
            'away_ml': {'odds': -9999, 'book': None},
            'home_spread': {'point': None, 'odds': -9999, 'book': None},
            'away_spread': {'point': None, 'odds': -9999, 'book': None},
            'over': {'point': None, 'odds': -9999, 'book': None},
            'under': {'point': None, 'odds': -9999, 'book': None}
        }
        
        for book in game.get('bookmakers', []):
            book_name = book.get('title', 'Unknown')
            
            for market in book.get('markets', []):
                key = market.get('key')
                
                for o in market.get('outcomes', []):
                    name = o.get('name')
                    price = o.get('price', -9999)
                    point = o.get('point')
                    
                    if key == 'h2h':
                        if name == game.get('home_team') and price > best['home_ml']['odds']:
                            best['home_ml'] = {'odds': price, 'book': book_name}
                        elif name == game.get('away_team') and price > best['away_ml']['odds']:
                            best['away_ml'] = {'odds': price, 'book': book_name}
                    
                    elif key == 'spreads':
                        if name == game.get('home_team') and price > best['home_spread']['odds']:
                            best['home_spread'] = {'point': point, 'odds': price, 'book': book_name}
                        elif name == game.get('away_team') and price > best['away_spread']['odds']:
                            best['away_spread'] = {'point': point, 'odds': price, 'book': book_name}
                    
                    elif key == 'totals':
                        if name == 'Over' and price > best['over']['odds']:
                            best['over'] = {'point': point, 'odds': price, 'book': book_name}
                        elif name == 'Under' and price > best['under']['odds']:
                            best['under'] = {'point': point, 'odds': price, 'book': book_name}
        
        return best
    
    def _check_arbitrage(self, best_odds: Dict, game: Dict) -> Dict:
        """Check for arbitrage opportunity"""
        home_ml = best_odds['home_ml']['odds']
        away_ml = best_odds['away_ml']['odds']
        
        if home_ml == -9999 or away_ml == -9999:
            return {'exists': False}
        
        def to_decimal(american):
            if american > 0:
                return (american / 100) + 1
            return (100 / abs(american)) + 1
        
        home_dec = to_decimal(home_ml)
        away_dec = to_decimal(away_ml)
        
        total_implied = (1 / home_dec) + (1 / away_dec)
        
        if total_implied < 1:
            profit = ((1 / total_implied) - 1) * 100
            return {
                'exists': True,
                'profit_pct': round(profit, 2),
                'home_odds': home_ml,
                'home_book': best_odds['home_ml']['book'],
                'away_odds': away_ml,
                'away_book': best_odds['away_ml']['book']
            }
        
        return {'exists': False, 'vig_pct': round((total_implied - 1) * 100, 2)}
    
    def get_execution_recommendation(self, edge: Dict, sport: str = 'basketball_nba') -> Dict:
        """
        Given an edge, find the best execution
        """
        games = self.fetch_and_track_odds(sport)
        
        edge_type = edge.get('type', 'MONEYLINE')
        direction = edge.get('direction', 'BET')
        target_prob = edge.get('target_prob', 50) / 100
        
        recommendations = []
        
        for game in games:
            best = self._find_best_odds(game)
            
            if edge_type == 'MONEYLINE':
                if direction in ['BET', 'HOME']:
                    odds = best['home_ml']['odds']
                    book = best['home_ml']['book']
                else:
                    odds = best['away_ml']['odds']
                    book = best['away_ml']['book']
            
            elif edge_type == 'SPREAD':
                if direction == 'COVER':
                    odds = best['home_spread']['odds']
                    book = best['home_spread']['book']
                else:
                    odds = best['away_spread']['odds']
                    book = best['away_spread']['book']
            
            elif edge_type == 'TOTAL':
                if direction == 'OVER':
                    odds = best['over']['odds']
                    book = best['over']['book']
                else:
                    odds = best['under']['odds']
                    book = best['under']['book']
            else:
                continue
            
            if odds == -9999 or not book:
                continue
            
            ev = self._calculate_ev(target_prob, odds)
            kelly = self._calculate_kelly(target_prob, odds)
            
            recommendations.append({
                'game': f"{game.get('away_team')} @ {game.get('home_team')}",
                'book': book,
                'odds': odds,
                'ev_per_dollar': round(ev, 4),
                'kelly_fraction': round(kelly, 4),
                'recommended_bet': round(self.bankroll * kelly, 2)
            })
        
        recommendations.sort(key=lambda x: x['ev_per_dollar'], reverse=True)
        return recommendations[0] if recommendations else {'error': 'No execution found'}
    
    def _calculate_ev(self, prob: float, odds: int) -> float:
        if odds < 0:
            profit = 100 / abs(odds)
        else:
            profit = odds / 100
        return (prob * profit) - ((1 - prob) * 1)
    
    def _calculate_kelly(self, prob: float, odds: int, fraction: float = 0.25) -> float:
        if odds < 0:
            decimal = (100 / abs(odds)) + 1
        else:
            decimal = (odds / 100) + 1
        
        b = decimal - 1
        q = 1 - prob
        kelly = (b * prob - q) / b
        return max(0, kelly * fraction)


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    print("\n" + "="*70)
    print("EXECUTION LAYER v3.0")
    print("Enhanced Line Movement Tracking")
    print("="*70)
    
    executor = ExecutionLayerV3()
    
    print("\n[NBA Market Analysis]")
    analysis = executor.get_market_analysis('basketball_nba')
    
    if 'error' in analysis:
        print(f"  Error: {analysis['error']}")
    else:
        print(f"  Games: {analysis['game_count']}")
        print(f"  Alerts: {analysis['alert_count']}")
        
        if analysis['alerts']:
            print("\n  🚨 ALERTS:")
            for alert in analysis['alerts']:
                print(f"    [{alert['type']}] {alert['game']}")
                print(f"      {alert['detail']}")
        
        print("\n  📊 BEST ODDS (First 3 games):")
        for game in analysis['games'][:3]:
            print(f"\n    {game['game']}")
            best = game['best_odds']
            print(f"      ML: Home {best['home_ml']['odds']} @ {best['home_ml']['book']}")
            print(f"          Away {best['away_ml']['odds']} @ {best['away_ml']['book']}")
            
            if game['velocity'].get('is_sharp'):
                print(f"      ⚡ SHARP: {game['velocity']['spread_velocity']} pts/hr")
            
            if game['steam_move'].get('detected'):
                print(f"      🔥 STEAM MOVE DETECTED")
        
        # Save analysis
        with open('market_analysis_v3.json', 'w') as f:
            json.dump(analysis, f, indent=2, default=str)
        print("\n  ✓ Saved market_analysis_v3.json")
    
    print("\n" + "="*70)
