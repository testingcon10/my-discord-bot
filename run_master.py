#!/usr/bin/env python3
"""
================================================================================
MASTER RUNNER - Update All Data & Find Edges
================================================================================

This script:
1. Fetches live data (injuries, scores, odds)
2. Runs edge detection
3. Finds best execution platforms
4. Outputs actionable betting recommendations

Run: python run_master.py
================================================================================
"""

import json
import os
import sys
from datetime import datetime

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def main():
    print("\n" + "="*70)
    print("VECTOR EDGE SYSTEM - MASTER RUNNER")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*70)

    # Step 1: Fetch Live Data
    print("\n[STEP 1/4] Fetching Live Data...")
    print("-"*50)
    try:
        from live_data_engine import LiveDataEngine
        engine = LiveDataEngine()
        
        nba_data = engine.fetch_all_live_data('nba')
        nfl_data = engine.fetch_all_live_data('nfl')
        
        print(f"  ✓ NBA: {len(nba_data['games'])} games, {len(nba_data['injuries'])} injuries")
        print(f"  ✓ NFL: {len(nfl_data['games'])} games, {len(nfl_data['injuries'])} injuries")
    except Exception as e:
        print(f"  ✗ Error: {e}")
        nba_data = {'games': [], 'injuries': []}
        nfl_data = {'games': [], 'injuries': []}

    # Step 2: Run Edge Detection
    print("\n[STEP 2/4] Running Edge Detection...")
    print("-"*50)
    try:
        from enhanced_edge_detector import EnhancedEdgeDetector, generate_training_data
        
        detector = EnhancedEdgeDetector()
        
        # Generate training data if needed
        if len(detector.vectors) < 100:
            print("  → Generating training data (first run)...")
            generate_training_data(detector, 500)
        
        print(f"  ✓ Loaded {len(detector.vectors)} historical games")
        
        # Analyze current games
        edges_found = []
        
        # Sample: analyze based on odds data
        # In production, this would use real game data
        sample_games = [
            {
                'team': 'Lakers', 'opponent': 'Celtics',
                'team_off_rating': 114.5, 'team_def_rating': 110.2,
                'opp_off_rating': 117.8, 'opp_def_rating': 108.5,
                'pace': 100.5, 'is_home': False,
                'team_rest_days': 2, 'opp_rest_days': 1,
                'last_5_wins': 3, 'last_10_wins': 6,
                'season_wins': 28, 'season_games': 50,
                'injury_impact': -0.1,
                'line_open': 6.5, 'line_current': 7.0,
                'public_pct': 42, 'total_line': 228.5,
                'spread': 7.0, 'moneyline': 250
            }
        ]
        
        for game in sample_games:
            result = detector.detect_edges(game)
            if result['edges']:
                edges_found.append({
                    'team': game['team'],
                    'opponent': game['opponent'],
                    **result
                })
        
        # Save edges
        with open('vector_edges.json', 'w') as f:
            json.dump(edges_found, f, indent=2)
        
        print(f"  ✓ Found {len(edges_found)} games with edges")
        
    except Exception as e:
        print(f"  ✗ Error: {e}")
        import traceback
        traceback.print_exc()

    # Step 3: Find Best Execution
    print("\n[STEP 3/4] Finding Best Execution Platforms...")
    print("-"*50)
    try:
        from execution_layer import ExecutionLayer
        
        executor = ExecutionLayer()
        
        # Scan markets
        nba_scan = executor.get_full_market_scan('basketball_nba')
        
        if 'error' not in nba_scan:
            print(f"  ✓ Scanned {nba_scan['game_count']} NBA games")
            print(f"  ✓ Arbitrage opportunities: {nba_scan['arbitrage_count']}")
            
            # Save scan
            with open('market_scan.json', 'w') as f:
                json.dump(nba_scan, f, indent=2, default=str)
        else:
            print(f"  ! {nba_scan['error']}")
            
    except Exception as e:
        print(f"  ✗ Error: {e}")

    # Step 4: Generate Report
    print("\n[STEP 4/4] Generating Report...")
    print("-"*50)
    
    report = {
        'timestamp': datetime.now().isoformat(),
        'summary': {
            'nba_games': len(nba_data.get('games', [])),
            'nfl_games': len(nfl_data.get('games', [])),
            'nba_injuries': len(nba_data.get('injuries', [])),
            'nfl_injuries': len(nfl_data.get('injuries', []))
        },
        'edges': edges_found if 'edges_found' in dir() else [],
        'arbitrage': nba_scan.get('arbitrages', []) if 'nba_scan' in dir() and isinstance(nba_scan, dict) else []
    }
    
    with open('daily_report.json', 'w') as f:
        json.dump(report, f, indent=2, default=str)
    
    print("  ✓ Saved daily_report.json")

    # Print Summary
    print("\n" + "="*70)
    print("SUMMARY")
    print("="*70)
    
    if report['arbitrage']:
        print("\n🔥 ARBITRAGE OPPORTUNITIES:")
        for arb in report['arbitrage'][:3]:
            print(f"  {arb.get('home_team', '?')} vs {arb.get('away_team', '?')}")
            print(f"    Profit: {arb.get('guaranteed_profit', '?')}% | ROI: {arb.get('roi_pct', '?')}%")
    
    if report['edges']:
        print("\n🎯 EDGES FOUND:")
        for edge in report['edges'][:3]:
            print(f"  {edge.get('team', '?')} vs {edge.get('opponent', '?')}: {edge.get('status', '?')}")
            for e in edge.get('edges', [])[:2]:
                print(f"    → {e['type']}: {e['direction']} ({e['advantage']:+.1f}%)")
    
    print("\n" + "="*70)
    print("Files created:")
    print("  - live_nba_data.json")
    print("  - live_nfl_data.json")
    print("  - nba_injuries.json")
    print("  - nfl_injuries.json")
    print("  - vector_edges.json")
    print("  - market_scan.json")
    print("  - daily_report.json")
    print("="*70 + "\n")


if __name__ == "__main__":
    main()
