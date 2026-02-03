#!/usr/bin/env python3
"""
================================================================================
EXECUTION LAYER - BEST PLATFORM SELECTOR
Finds the best odds across multiple platforms for executing bets
================================================================================

Supported Platforms (via The Odds API):
- DraftKings
- FanDuel
- BetMGM
- Caesars
- PointsBet
- BetRivers
- Barstool
- WynnBET
- Unibet
- FOX Bet
- Kalshi (prediction markets)

Features:
1. Real-time odds comparison across all books
2. Best line identification (ML, Spread, Total)
3. Arbitrage detection (guaranteed profit opportunities)
4. Expected Value (EV) calculation
5. Optimal bet sizing (Kelly Criterion)
6. Execution logging for tracking

================================================================================
"""

import json
import os
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import requests

# Load environment
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


class ExecutionLayer:
    """
    Finds and recommends optimal bet execution across platforms
    """
    
    ODDS_API_BASE = 'https://api.the-odds-api.com/v4'
    
    # Platform priority (by general liquidity/reliability)
    PLATFORM_PRIORITY = [
        'DraftKings',
        'FanDuel', 
        'BetMGM',
        'Caesars',
        'PointsBet',
        'BetRivers',
        'Barstool',
        'WynnBET',
        'Unibet'
    ]
    
    # Prediction markets (different API)
    PREDICTION_MARKETS = ['Kalshi', 'Polymarket']
    
    def __init__(self, odds_api_key: Optional[str] = None, bankroll: float = 1000):
        self.api_key = odds_api_key or os.getenv('ODDS_API_KEY')
        self.bankroll = bankroll
        self.execution_log = []
        
    # =========================================================================
    # ODDS FETCHING
    # =========================================================================
    
    def fetch_odds(self, sport: str = 'basketball_nba') -> List[Dict]:
        """
        Fetch odds from all available sportsbooks
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
            
            # Log remaining quota
            remaining = resp.headers.get('x-requests-remaining', '?')
            print(f"[Odds API] Quota remaining: {remaining}")
            
            return resp.json()
            
        except Exception as e:
            print(f"[ERROR] {e}")
            return []
    
    def fetch_kalshi_odds(self, search_term: str = None) -> List[Dict]:
        """
        Fetch prediction market odds from Kalshi
        """
        url = 'https://api.elections.kalshi.com/trade-api/v2/markets'
        params = {
            'limit': 200,
            'status': 'open'
        }
        
        try:
            resp = requests.get(url, params=params, timeout=10)
            markets = resp.json().get('markets', [])
            
            # Filter for sports if search term provided
            if search_term:
                term = search_term.upper()
                markets = [m for m in markets if term in (m.get('title', '') + m.get('ticker', '')).upper()]
            
            # Filter out MULTIGAME/parlay markets
            markets = [m for m in markets if 'MULTIGAME' not in m.get('ticker', '').upper()]
            
            return markets
            
        except Exception as e:
            print(f"[Kalshi Error] {e}")
            return []

    # =========================================================================
    # ODDS COMPARISON
    # =========================================================================
    
    def compare_moneyline(self, game_odds: Dict) -> Dict:
        """
        Compare moneyline odds across all books for a single game
        Returns best odds for each team
        """
        bookmakers = game_odds.get('bookmakers', [])
        home_team = game_odds.get('home_team', '')
        away_team = game_odds.get('away_team', '')
        
        best_home = {'odds': -9999, 'book': None}
        best_away = {'odds': -9999, 'book': None}
        
        all_home = []
        all_away = []
        
        for book in bookmakers:
            book_name = book.get('title', 'Unknown')
            h2h = next((m for m in book.get('markets', []) if m.get('key') == 'h2h'), None)
            
            if not h2h:
                continue
            
            for outcome in h2h.get('outcomes', []):
                team = outcome.get('name', '')
                odds = outcome.get('price', 0)
                
                if team == home_team:
                    all_home.append({'book': book_name, 'odds': odds})
                    if odds > best_home['odds']:
                        best_home = {'odds': odds, 'book': book_name}
                        
                elif team == away_team:
                    all_away.append({'book': book_name, 'odds': odds})
                    if odds > best_away['odds']:
                        best_away = {'odds': odds, 'book': book_name}
        
        return {
            'home_team': home_team,
            'away_team': away_team,
            'best_home': best_home,
            'best_away': best_away,
            'all_home': sorted(all_home, key=lambda x: x['odds'], reverse=True),
            'all_away': sorted(all_away, key=lambda x: x['odds'], reverse=True),
            'home_range': (min(o['odds'] for o in all_home), max(o['odds'] for o in all_home)) if all_home else (0, 0),
            'away_range': (min(o['odds'] for o in all_away), max(o['odds'] for o in all_away)) if all_away else (0, 0)
        }
    
    def compare_spread(self, game_odds: Dict) -> Dict:
        """
        Compare spread/point spread across all books
        """
        bookmakers = game_odds.get('bookmakers', [])
        home_team = game_odds.get('home_team', '')
        away_team = game_odds.get('away_team', '')
        
        spreads = []
        
        for book in bookmakers:
            book_name = book.get('title', 'Unknown')
            spread_market = next((m for m in book.get('markets', []) if m.get('key') == 'spreads'), None)
            
            if not spread_market:
                continue
            
            for outcome in spread_market.get('outcomes', []):
                spreads.append({
                    'book': book_name,
                    'team': outcome.get('name', ''),
                    'line': outcome.get('point', 0),
                    'odds': outcome.get('price', -110)
                })
        
        # Find best spread for each team
        home_spreads = [s for s in spreads if s['team'] == home_team]
        away_spreads = [s for s in spreads if s['team'] == away_team]
        
        best_home = max(home_spreads, key=lambda x: x['odds']) if home_spreads else None
        best_away = max(away_spreads, key=lambda x: x['odds']) if away_spreads else None
        
        return {
            'home_team': home_team,
            'away_team': away_team,
            'best_home_spread': best_home,
            'best_away_spread': best_away,
            'all_spreads': spreads
        }
    
    def compare_total(self, game_odds: Dict) -> Dict:
        """
        Compare over/under totals across all books
        """
        bookmakers = game_odds.get('bookmakers', [])
        
        totals = []
        
        for book in bookmakers:
            book_name = book.get('title', 'Unknown')
            total_market = next((m for m in book.get('markets', []) if m.get('key') == 'totals'), None)
            
            if not total_market:
                continue
            
            for outcome in total_market.get('outcomes', []):
                totals.append({
                    'book': book_name,
                    'direction': outcome.get('name', ''),  # Over or Under
                    'line': outcome.get('point', 0),
                    'odds': outcome.get('price', -110)
                })
        
        overs = [t for t in totals if t['direction'] == 'Over']
        unders = [t for t in totals if t['direction'] == 'Under']
        
        best_over = max(overs, key=lambda x: x['odds']) if overs else None
        best_under = max(unders, key=lambda x: x['odds']) if unders else None
        
        return {
            'best_over': best_over,
            'best_under': best_under,
            'all_totals': totals
        }

    # =========================================================================
    # ARBITRAGE DETECTION
    # =========================================================================
    
    def detect_arbitrage(self, game_odds: Dict) -> Optional[Dict]:
        """
        Detect arbitrage opportunities (guaranteed profit)
        
        Arbitrage exists when:
        1/odds_team1 + 1/odds_team2 < 1 (converted to decimal)
        """
        ml_comparison = self.compare_moneyline(game_odds)
        
        best_home = ml_comparison['best_home']['odds']
        best_away = ml_comparison['best_away']['odds']
        
        if not best_home or not best_away:
            return None
        
        # Convert to decimal odds
        def american_to_decimal(odds):
            if odds > 0:
                return (odds / 100) + 1
            return (100 / abs(odds)) + 1
        
        home_dec = american_to_decimal(best_home)
        away_dec = american_to_decimal(best_away)
        
        # Calculate implied probabilities
        home_prob = 1 / home_dec
        away_prob = 1 / away_dec
        total_prob = home_prob + away_prob
        
        # Arbitrage exists if total < 1
        if total_prob < 1:
            # Calculate optimal stakes for $100 total bet
            total_stake = 100
            home_stake = (home_prob / total_prob) * total_stake
            away_stake = (away_prob / total_prob) * total_stake
            
            # Calculate guaranteed profit
            home_payout = home_stake * home_dec
            away_payout = away_stake * away_dec
            profit = min(home_payout, away_payout) - total_stake
            roi = (profit / total_stake) * 100
            
            return {
                'type': 'ARBITRAGE',
                'home_team': ml_comparison['home_team'],
                'away_team': ml_comparison['away_team'],
                'home_odds': best_home,
                'home_book': ml_comparison['best_home']['book'],
                'away_odds': best_away,
                'away_book': ml_comparison['best_away']['book'],
                'home_stake': round(home_stake, 2),
                'away_stake': round(away_stake, 2),
                'guaranteed_profit': round(profit, 2),
                'roi_pct': round(roi, 2),
                'total_implied': round(total_prob * 100, 2)
            }
        
        return None

    # =========================================================================
    # EXPECTED VALUE CALCULATION
    # =========================================================================
    
    def calculate_ev(self, true_prob: float, odds: int) -> float:
        """
        Calculate expected value of a bet
        
        EV = (prob * profit) - ((1-prob) * stake)
        
        Args:
            true_prob: Our estimated true probability (0-1)
            odds: American odds
        
        Returns:
            EV per $1 wagered
        """
        if odds < 0:
            profit = 100 / abs(odds)
        else:
            profit = odds / 100
        
        ev = (true_prob * profit) - ((1 - true_prob) * 1)
        return round(ev, 4)
    
    def calculate_kelly(self, true_prob: float, odds: int, fraction: float = 0.25) -> float:
        """
        Calculate optimal bet size using Kelly Criterion
        
        Full Kelly: f* = (bp - q) / b
        where b = decimal odds - 1, p = true prob, q = 1-p
        
        We use fractional Kelly (default 25%) for safety
        
        Returns: Recommended bet as fraction of bankroll
        """
        if odds < 0:
            decimal_odds = (100 / abs(odds)) + 1
        else:
            decimal_odds = (odds / 100) + 1
        
        b = decimal_odds - 1
        p = true_prob
        q = 1 - p
        
        kelly = (b * p - q) / b
        
        # Apply fraction and floor at 0
        return max(0, kelly * fraction)

    # =========================================================================
    # EXECUTION RECOMMENDATION
    # =========================================================================
    
    def recommend_execution(self, edge: Dict, sport: str = 'basketball_nba') -> Dict:
        """
        Given an edge from the EdgeDetector, find the best execution
        
        Args:
            edge: Edge dict with type, direction, target_prob, etc.
            sport: Sport key for odds API
        
        Returns:
            Execution recommendation with platform, odds, bet size
        """
        # Fetch current odds
        all_odds = self.fetch_odds(sport)
        
        if not all_odds:
            return {'error': 'Could not fetch odds'}
        
        edge_type = edge.get('type', 'MONEYLINE')
        direction = edge.get('direction', 'BET')
        target_prob = edge.get('target_prob', 50) / 100  # Convert to decimal
        
        best_execution = None
        best_ev = -999
        
        for game_odds in all_odds:
            # Find best odds based on edge type
            if edge_type == 'MONEYLINE':
                comparison = self.compare_moneyline(game_odds)
                
                if direction == 'BET':
                    odds = comparison['best_home']['odds']
                    book = comparison['best_home']['book']
                else:
                    odds = comparison['best_away']['odds']
                    book = comparison['best_away']['book']
                    
            elif edge_type == 'SPREAD':
                comparison = self.compare_spread(game_odds)
                
                if direction == 'COVER':
                    best = comparison['best_home_spread']
                else:
                    best = comparison['best_away_spread']
                
                if best:
                    odds = best['odds']
                    book = best['book']
                else:
                    continue
                    
            elif edge_type == 'TOTAL':
                comparison = self.compare_total(game_odds)
                
                if direction == 'OVER':
                    best = comparison['best_over']
                else:
                    best = comparison['best_under']
                
                if best:
                    odds = best['odds']
                    book = best['book']
                else:
                    continue
            
            # Calculate EV
            ev = self.calculate_ev(target_prob, odds)
            
            if ev > best_ev:
                best_ev = ev
                kelly = self.calculate_kelly(target_prob, odds)
                
                best_execution = {
                    'game': f"{game_odds.get('away_team')} @ {game_odds.get('home_team')}",
                    'edge_type': edge_type,
                    'direction': direction,
                    'best_book': book,
                    'best_odds': odds,
                    'target_prob': round(target_prob * 100, 1),
                    'ev_per_dollar': round(ev, 4),
                    'kelly_fraction': round(kelly, 4),
                    'recommended_bet': round(self.bankroll * kelly, 2),
                    'commence_time': game_odds.get('commence_time')
                }
        
        if best_execution:
            # Log execution
            self.execution_log.append({
                **best_execution,
                'timestamp': datetime.now().isoformat()
            })
        
        return best_execution or {'error': 'No suitable execution found'}
    
    def get_full_market_scan(self, sport: str = 'basketball_nba') -> Dict:
        """
        Full scan of all games showing best odds for each
        """
        all_odds = self.fetch_odds(sport)
        
        if not all_odds:
            return {'error': 'Could not fetch odds', 'games': []}
        
        games = []
        arbitrages = []
        
        for game_odds in all_odds:
            ml = self.compare_moneyline(game_odds)
            spread = self.compare_spread(game_odds)
            total = self.compare_total(game_odds)
            
            # Check for arbitrage
            arb = self.detect_arbitrage(game_odds)
            if arb:
                arbitrages.append(arb)
            
            games.append({
                'game': f"{game_odds.get('away_team')} @ {game_odds.get('home_team')}",
                'commence_time': game_odds.get('commence_time'),
                'moneyline': {
                    'home': ml['best_home'],
                    'away': ml['best_away'],
                    'home_range': ml['home_range'],
                    'away_range': ml['away_range']
                },
                'spread': {
                    'home': spread['best_home_spread'],
                    'away': spread['best_away_spread']
                },
                'total': {
                    'over': total['best_over'],
                    'under': total['best_under']
                },
                'book_count': len(game_odds.get('bookmakers', []))
            })
        
        return {
            'sport': sport,
            'timestamp': datetime.now().isoformat(),
            'game_count': len(games),
            'games': games,
            'arbitrages': arbitrages,
            'arbitrage_count': len(arbitrages)
        }


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    print("\n" + "="*70)
    print("EXECUTION LAYER - BEST PLATFORM SELECTOR")
    print("="*70)
    
    executor = ExecutionLayer(bankroll=1000)
    
    # Scan NBA market
    print("\n[NBA] Scanning market...")
    nba_scan = executor.get_full_market_scan('basketball_nba')
    
    if 'error' not in nba_scan:
        print(f"\nFound {nba_scan['game_count']} games across multiple books")
        
        # Show arbitrage opportunities
        if nba_scan['arbitrages']:
            print(f"\n🔥 ARBITRAGE OPPORTUNITIES: {len(nba_scan['arbitrages'])}")
            for arb in nba_scan['arbitrages']:
                print(f"\n  {arb['home_team']} vs {arb['away_team']}")
                print(f"  Home: {arb['home_odds']} @ {arb['home_book']} (${arb['home_stake']})")
                print(f"  Away: {arb['away_odds']} @ {arb['away_book']} (${arb['away_stake']})")
                print(f"  Guaranteed Profit: ${arb['guaranteed_profit']} ({arb['roi_pct']}% ROI)")
        else:
            print("\nNo arbitrage opportunities found")
        
        # Show best odds per game
        print("\n" + "-"*70)
        print("BEST ODDS BY GAME")
        print("-"*70)
        
        for game in nba_scan['games'][:5]:  # First 5 games
            print(f"\n{game['game']}")
            ml = game['moneyline']
            print(f"  ML: Home {ml['home']['odds']} @ {ml['home']['book']} | Away {ml['away']['odds']} @ {ml['away']['book']}")
            
            spread = game['spread']
            if spread['home']:
                print(f"  Spread: Home {spread['home']['line']} ({spread['home']['odds']}) @ {spread['home']['book']}")
            
            total = game['total']
            if total['over']:
                print(f"  Total: O {total['over']['line']} ({total['over']['odds']}) @ {total['over']['book']}")
        
        # Save full scan
        with open('market_scan.json', 'w') as f:
            json.dump(nba_scan, f, indent=2, default=str)
        print(f"\n[SAVED] market_scan.json")
    
    else:
        print(f"Error: {nba_scan['error']}")
    
    print("\n" + "="*70)
