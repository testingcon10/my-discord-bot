#!/usr/bin/env python3
"""
================================================================================
MASTER RUNNER v3.1 - With Real Stats
================================================================================

Now uses:
- real_stats_engine.py: Actual NBA team ratings
- historical_backfill.py: Real historical training data
- expanded_edge_detector_v3.py: 32-dim vectors
- execution_layer_v3.py: Line tracking

================================================================================
"""

import json
import os
import sys
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except:
    pass

ODDS_API_KEY = os.getenv('ODDS_API_KEY')


def main():
    print("\n" + "="*70)
    print("VECTOR EDGE SYSTEM v3.1 - REAL STATS")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*70)

    if ODDS_API_KEY:
        print("✓ ODDS_API_KEY loaded")
    else:
        print("⚠️  ODDS_API_KEY not set")

    results = {
        'timestamp': datetime.now().isoformat(),
        'injuries': {'nba': 0, 'nfl': 0},
        'games': {'nba': 0, 'nfl': 0},
        'alerts': [],
        'edges': [],
        'arbitrages': []
    }

    # =========================================================================
    # STEP 1: Fetch Real Team Stats
    # =========================================================================
    print("\n" + "="*70)
    print("[STEP 1/5] REAL TEAM STATS")
    print("="*70)
    
    team_stats = {}
    
    try:
        from real_stats_engine import RealStatsEngine
        stats_engine = RealStatsEngine()
        team_stats = stats_engine.fetch_all_team_stats()
        
        if team_stats:
            print(f"\n  ✓ Loaded stats for {len(team_stats)} teams")
            
            # Show top 5
            sorted_teams = sorted(team_stats.items(), key=lambda x: x[1].get('net_rating', 0), reverse=True)
            print("\n  Top 5 by Net Rating:")
            for abbrev, data in sorted_teams[:5]:
                print(f"    {abbrev}: OFF {data.get('off_rating', 0):.1f} | DEF {data.get('def_rating', 0):.1f} | NET {data.get('net_rating', 0):+.1f}")
        else:
            print("  ⚠️  Could not fetch team stats")
            
    except ImportError:
        print("  [SKIP] real_stats_engine.py not found")
    except Exception as e:
        print(f"  [ERROR] {e}")

    # =========================================================================
    # STEP 2: Fetch Injuries
    # =========================================================================
    print("\n" + "="*70)
    print("[STEP 2/5] INJURIES")
    print("="*70)
    
    injuries = {'nba': [], 'nfl': []}
    
    try:
        import requests
        
        for sport, path in [('nba', 'basketball/nba'), ('nfl', 'football/nfl')]:
            try:
                r = requests.get(
                    f'https://site.api.espn.com/apis/site/v2/sports/{path}/injuries',
                    timeout=10
                )
                for team in r.json().get('injuries', []):
                    for p in team.get('injuries', []):
                        injuries[sport].append({
                            'team': team.get('team', {}).get('abbreviation', '???'),
                            'player': p.get('athlete', {}).get('displayName', '?'),
                            'status': p.get('status', '?'),
                            'injury': p.get('type', {}).get('detail', '?')
                        })
                print(f"  {sport.upper()}: {len(injuries[sport])} injuries")
                results['injuries'][sport] = len(injuries[sport])
                
                with open(f'{sport}_injuries.json', 'w') as f:
                    json.dump(injuries[sport], f, indent=2)
                    
            except Exception as e:
                print(f"  {sport.upper()}: Error - {e}")
    except:
        print("  [SKIP] requests not available")

    # =========================================================================
    # STEP 3: Market Analysis
    # =========================================================================
    print("\n" + "="*70)
    print("[STEP 3/5] MARKET ANALYSIS")
    print("="*70)
    
    market_data = {'nba': None, 'nfl': None}
    
    if not ODDS_API_KEY:
        print("  [SKIP] No ODDS_API_KEY")
    else:
        try:
            from execution_layer_v3 import ExecutionLayerV3
            executor = ExecutionLayerV3(odds_api_key=ODDS_API_KEY)
            
            for sport, key in [('nba', 'basketball_nba'), ('nfl', 'americanfootball_nfl')]:
                print(f"\n  [{sport.upper()}]")
                analysis = executor.get_market_analysis(key)
                
                if 'error' not in analysis:
                    market_data[sport] = analysis
                    results['games'][sport] = analysis['game_count']
                    
                    print(f"    Games: {analysis['game_count']}")
                    print(f"    Alerts: {analysis['alert_count']}")
                    
                    for alert in analysis.get('alerts', []):
                        results['alerts'].append({'sport': sport.upper(), **alert})
                    
                    for game in analysis.get('games', []):
                        if game.get('arbitrage', {}).get('exists'):
                            results['arbitrages'].append({
                                'sport': sport.upper(),
                                'game': game['game'],
                                **game['arbitrage']
                            })
                else:
                    print(f"    Error: {analysis['error']}")
                    
        except ImportError:
            print("  [SKIP] execution_layer_v3.py not found")
        except Exception as e:
            print(f"  [ERROR] {e}")

    # =========================================================================
    # STEP 4: Edge Detection with REAL STATS
    # =========================================================================
    print("\n" + "="*70)
    print("[STEP 4/5] EDGE DETECTION (Real Stats)")
    print("="*70)
    
    try:
        from expanded_edge_detector_v3 import ExpandedEdgeDetector, generate_training_data
        
        detector = ExpandedEdgeDetector()
        print(f"\n  Vectors loaded: {len(detector.vectors)}")
        
        # Check if we need training data
        if len(detector.vectors) < 500:
            # Try to load from historical backfill first
            try:
                import pickle
                if os.path.exists('historical_training_data.pkl'):
                    with open('historical_training_data.pkl', 'rb') as f:
                        data = pickle.load(f)
                        hist_vectors = data.get('vectors', [])
                        if hist_vectors:
                            print(f"  Loading {len(hist_vectors)} historical vectors...")
                            for vec, meta in hist_vectors:
                                detector.vectors.append((vec, {
                                    'game_data': meta.get('game_data', meta),
                                    'outcome': meta.get('outcome', {})
                                }))
                            detector.save()
                            detector._build_faiss_index()
            except Exception as e:
                print(f"  Could not load historical: {e}")
            
            # Generate synthetic if still not enough
            if len(detector.vectors) < 500:
                print("  Generating training data...")
                generate_training_data(detector, 1000)
        
        print(f"  Final vector count: {len(detector.vectors)}")
        
        # Analyze real games with REAL STATS
        if market_data['nba'] and market_data['nba'].get('games'):
            print(f"\n  Analyzing {len(market_data['nba']['games'])} NBA games with real stats...")
            
            for game_analysis in market_data['nba']['games'][:15]:
                game_str = game_analysis.get('game', '')
                parts = game_str.split(' @ ')
                
                if len(parts) != 2:
                    continue
                
                away_team, home_team = parts[0].strip(), parts[1].strip()
                
                # Map full names to abbreviations
                name_to_abbrev = {
                    'Boston Celtics': 'BOS', 'Miami Heat': 'MIA', 'Milwaukee Bucks': 'MIL',
                    'Denver Nuggets': 'DEN', 'Los Angeles Lakers': 'LAL', 'Phoenix Suns': 'PHX',
                    'Golden State Warriors': 'GSW', 'Dallas Mavericks': 'DAL',
                    'Philadelphia 76ers': 'PHI', 'Cleveland Cavaliers': 'CLE',
                    'Oklahoma City Thunder': 'OKC', 'Minnesota Timberwolves': 'MIN',
                    'New York Knicks': 'NYK', 'Sacramento Kings': 'SAC',
                    'Indiana Pacers': 'IND', 'Orlando Magic': 'ORL',
                    'Atlanta Hawks': 'ATL', 'Chicago Bulls': 'CHI',
                    'Brooklyn Nets': 'BKN', 'Toronto Raptors': 'TOR',
                    'Houston Rockets': 'HOU', 'Memphis Grizzlies': 'MEM',
                    'New Orleans Pelicans': 'NOP', 'San Antonio Spurs': 'SAS',
                    'Portland Trail Blazers': 'POR', 'Utah Jazz': 'UTA',
                    'Los Angeles Clippers': 'LAC', 'Detroit Pistons': 'DET',
                    'Charlotte Hornets': 'CHA', 'Washington Wizards': 'WAS'
                }
                
                home_abbrev = name_to_abbrev.get(home_team, home_team[:3].upper())
                away_abbrev = name_to_abbrev.get(away_team, away_team[:3].upper())
                
                # Get REAL stats for these teams
                home_stats = team_stats.get(home_abbrev, {})
                away_stats = team_stats.get(away_abbrev, {})
                
                # Get odds data
                best = game_analysis.get('best_odds', {})
                movement = game_analysis.get('line_movement', {})
                
                home_spread = best.get('home_spread', {})
                home_ml = best.get('home_ml', {}).get('odds', -110)
                
                # Get injuries
                game_injuries = [
                    i for i in injuries['nba']
                    if i['team'] in [home_abbrev, away_abbrev]
                ]
                
                # Build game data with REAL STATS
                game_data = {
                    'team': home_abbrev,
                    'opponent': away_abbrev,
                    # REAL offensive/defensive ratings
                    'team_off_rating': home_stats.get('off_rating', 112),
                    'team_def_rating': home_stats.get('def_rating', 110),
                    'team_net_L10': home_stats.get('net_rating', 0),
                    'opp_off_rating': away_stats.get('off_rating', 111),
                    'opp_def_rating': away_stats.get('def_rating', 109),
                    'opp_net_L10': away_stats.get('net_rating', 0),
                    # REAL pace
                    'pace': home_stats.get('pace', 100),
                    'opp_pace': away_stats.get('pace', 100),
                    # Other features
                    'is_home': True,
                    'rest_days': 2,
                    'opp_rest_days': 2,
                    'back_to_back': False,
                    'last_location': home_abbrev,
                    'injuries': game_injuries,
                    'star_minutes_L5': 34,
                    'line_open': movement.get('spread_open', 0),
                    'line_current': movement.get('spread_current', 0),
                    'public_pct': 50,
                    'book_odds': {},
                    'total_line': best.get('over', {}).get('point', 220) if best.get('over') else 220,
                    'spread': home_spread.get('point', 0) if home_spread else 0,
                    'moneyline': home_ml if isinstance(home_ml, int) else -110,
                    'game_importance': 0.5,
                    'game_id': game_analysis.get('game_id', '')
                }
                
                # Detect edges
                edge_result = detector.detect_edges(game_data)
                
                if edge_result['status'] in ['STRONG_EDGE', 'MODERATE_EDGE']:
                    edge_entry = {
                        'game': game_str,
                        'home': home_abbrev,
                        'away': away_abbrev,
                        'status': edge_result['status'],
                        'sample_size': edge_result['sample_size'],
                        'home_stats': {
                            'off': home_stats.get('off_rating', 0),
                            'def': home_stats.get('def_rating', 0),
                            'net': home_stats.get('net_rating', 0)
                        },
                        'away_stats': {
                            'off': away_stats.get('off_rating', 0),
                            'def': away_stats.get('def_rating', 0),
                            'net': away_stats.get('net_rating', 0)
                        },
                        'edges': edge_result['edges']
                    }
                    results['edges'].append(edge_entry)
            
            print(f"  Found {len(results['edges'])} games with edges")
        else:
            print("  No games to analyze")
            
    except ImportError as e:
        print(f"  [SKIP] Module not found: {e}")
    except Exception as e:
        print(f"  [ERROR] {e}")
        import traceback
        traceback.print_exc()

    # =========================================================================
    # STEP 5: Save Results
    # =========================================================================
    print("\n" + "="*70)
    print("[STEP 5/5] SAVING RESULTS")
    print("="*70)
    
    with open('vector_edges.json', 'w') as f:
        json.dump(results['edges'], f, indent=2)
    print(f"  ✓ vector_edges.json ({len(results['edges'])} edges)")
    
    with open('market_scan.json', 'w') as f:
        json.dump({
            'timestamp': results['timestamp'],
            'nba': market_data['nba'],
            'nfl': market_data['nfl']
        }, f, indent=2, default=str)
    print("  ✓ market_scan.json")
    
    with open('daily_report.json', 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print("  ✓ daily_report.json")

    # =========================================================================
    # SUMMARY
    # =========================================================================
    print("\n" + "="*70)
    print("RESULTS SUMMARY")
    print("="*70)
    
    if results['alerts']:
        print(f"\n🚨 ALERTS ({len(results['alerts'])}):")
        for alert in results['alerts'][:5]:
            print(f"  [{alert['type']}] {alert['game']}")
            print(f"    {alert['detail']}")
    
    if results['arbitrages']:
        print(f"\n🔥 ARBITRAGE ({len(results['arbitrages'])}):")
        for arb in results['arbitrages'][:3]:
            print(f"  {arb['game']} ({arb['sport']})")
            print(f"    💰 {arb['profit_pct']}% guaranteed")
    
    if results['edges']:
        print(f"\n🎯 EDGES WITH REAL STATS ({len(results['edges'])}):")
        for edge in results['edges'][:5]:
            print(f"\n  {edge['game']}: {edge['status']}")
            print(f"    {edge['home']}: OFF {edge['home_stats']['off']:.1f} | DEF {edge['home_stats']['def']:.1f} | NET {edge['home_stats']['net']:+.1f}")
            print(f"    {edge['away']}: OFF {edge['away_stats']['off']:.1f} | DEF {edge['away_stats']['def']:.1f} | NET {edge['away_stats']['net']:+.1f}")
            for e in edge.get('edges', [])[:2]:
                signals = f" [{', '.join(e.get('signals', []))}]" if e.get('signals') else ''
                print(f"    → {e['type']}: {e['direction']} ({e['advantage']:+.1f}%){signals}")
    else:
        print("\n  No significant edges found")
    
    print("\n" + "="*70)


if __name__ == "__main__":
    main()
