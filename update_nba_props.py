#!/usr/bin/env python3
"""
NBA PLAYER PROPS ARBITRAGE MODEL
Finds edges between market lines and actual player performance

Metrics:
- PPG_EDGE: Points per game vs opponent defense
- PACE_ADJ: Performance adjusted for game pace
- DEF_MATCHUP: How opponent defends this position
- RECENT_FORM: Last 5 games vs season average

Run: python3 update_nba_props.py
Output: nba_props_data.json
"""

import json
import sys
from datetime import datetime, timedelta

try:
    from nba_api.stats.endpoints import (
        playergamelog,
        leaguedashteamstats,
        commonteamroster,
        scoreboardv2,
        leaguedashplayerstats
    )
    from nba_api.stats.static import players, teams
    import pandas as pd
    import numpy as np
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Run: pip3 install nba_api pandas numpy")
    with open('nba_props_data.json', 'w') as f:
        json.dump([], f)
    sys.exit(0)

import time

# Rate limiting for NBA API
def api_call_with_retry(func, max_retries=3):
    for i in range(max_retries):
        try:
            time.sleep(0.6)  # NBA API rate limit
            return func()
        except Exception as e:
            if i == max_retries - 1:
                raise e
            time.sleep(2)

def get_todays_games():
    """Get today's NBA games"""
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        scoreboard = api_call_with_retry(
            lambda: scoreboardv2.ScoreboardV2(game_date=today)
        )
        games = scoreboard.get_normalized_dict()['GameHeader']
        return games
    except Exception as e:
        print(f"Error getting games: {e}")
        return []

def get_team_defense_vs_position():
    """Get how each team defends against each position"""
    try:
        # League stats by position
        stats = api_call_with_retry(
            lambda: leaguedashteamstats.LeagueDashTeamStats(
                season='2024-25',
                measure_type_detailed_defense='Opponent'
            )
        )
        df = stats.get_data_frames()[0]
        
        # Calculate points allowed per game
        defense = {}
        for _, row in df.iterrows():
            team_id = row['TEAM_ID']
            team_abbrev = row['TEAM_ABBREVIATION']
            opp_ppg = row.get('OPP_PTS', 0) / max(row.get('GP', 1), 1)
            defense[team_abbrev] = {
                'OPP_PPG': round(opp_ppg, 1),
                'DEF_RATING': row.get('DEF_RATING', 110)
            }
        return defense
    except Exception as e:
        print(f"Error getting defense stats: {e}")
        return {}

def get_player_recent_form(player_id, num_games=5):
    """Get player's last N games vs season average"""
    try:
        gamelog = api_call_with_retry(
            lambda: playergamelog.PlayerGameLog(
                player_id=player_id,
                season='2024-25'
            )
        )
        df = gamelog.get_data_frames()[0]
        
        if len(df) < num_games:
            return None
        
        recent = df.head(num_games)
        season = df
        
        return {
            'recent_ppg': round(recent['PTS'].mean(), 1),
            'season_ppg': round(season['PTS'].mean(), 1),
            'recent_rpg': round(recent['REB'].mean(), 1),
            'season_rpg': round(season['REB'].mean(), 1),
            'recent_apg': round(recent['AST'].mean(), 1),
            'season_apg': round(season['AST'].mean(), 1),
            'recent_min': round(recent['MIN'].mean(), 1),
            'games_played': len(season)
        }
    except Exception as e:
        print(f"Error getting player form: {e}")
        return None

def get_top_players():
    """Get top players by PPG for analysis"""
    try:
        stats = api_call_with_retry(
            lambda: leaguedashplayerstats.LeagueDashPlayerStats(
                season='2024-25',
                per_mode_detailed='PerGame'
            )
        )
        df = stats.get_data_frames()[0]
        
        # Filter for players with significant minutes
        df = df[df['MIN'] >= 20]
        df = df[df['GP'] >= 10]
        
        # Sort by PPG
        df = df.sort_values('PTS', ascending=False).head(50)
        
        return df[['PLAYER_ID', 'PLAYER_NAME', 'TEAM_ABBREVIATION', 'PTS', 'REB', 'AST', 'MIN', 'GP']].to_dict('records')
    except Exception as e:
        print(f"Error getting top players: {e}")
        return []

def calculate_prop_edges():
    """Main function to calculate player prop edges"""
    print("[NBA Props] Starting analysis...")
    
    # Get data
    print("[NBA Props] Fetching team defense stats...")
    team_defense = get_team_defense_vs_position()
    
    print("[NBA Props] Fetching top players...")
    top_players = get_top_players()
    
    if not top_players:
        print("No player data available")
        with open('nba_props_data.json', 'w') as f:
            json.dump([], f)
        return
    
    print(f"[NBA Props] Analyzing {len(top_players)} players...")
    
    edges = []
    
    for i, player in enumerate(top_players[:30]):  # Limit to top 30 to avoid rate limits
        print(f"  [{i+1}/30] {player['PLAYER_NAME']}...")
        
        form = get_player_recent_form(player['PLAYER_ID'])
        if not form:
            continue
        
        # Calculate edges
        pts_edge = form['recent_ppg'] - form['season_ppg']
        reb_edge = form['recent_rpg'] - form['season_rpg']
        ast_edge = form['recent_apg'] - form['season_apg']
        
        # Determine status
        def get_status(edge, threshold=1.5):
            if edge > threshold:
                return 'HOT'  # Recent form above average - OVER
            elif edge < -threshold:
                return 'COLD'  # Recent form below average - UNDER
            else:
                return 'NEUTRAL'
        
        pts_status = get_status(pts_edge)
        
        # Determine overall action
        if pts_status == 'HOT':
            action = 'OVER'
            confidence = min(abs(pts_edge) / 3 * 100, 100)
        elif pts_status == 'COLD':
            action = 'UNDER'
            confidence = min(abs(pts_edge) / 3 * 100, 100)
        else:
            action = 'PASS'
            confidence = 0
        
        edges.append({
            'player': player['PLAYER_NAME'],
            'team': player['TEAM_ABBREVIATION'],
            'season_ppg': form['season_ppg'],
            'recent_ppg': form['recent_ppg'],
            'pts_edge': round(pts_edge, 1),
            'season_rpg': form['season_rpg'],
            'recent_rpg': form['recent_rpg'],
            'reb_edge': round(reb_edge, 1),
            'season_apg': form['season_apg'],
            'recent_apg': form['recent_apg'],
            'ast_edge': round(ast_edge, 1),
            'status': pts_status,
            'action': action,
            'confidence': round(confidence, 0),
            'minutes': form['recent_min']
        })
    
    # Sort by absolute edge
    edges.sort(key=lambda x: abs(x['pts_edge']), reverse=True)
    
    # Save
    with open('nba_props_data.json', 'w') as f:
        json.dump(edges, f, indent=2)
    
    hot = len([e for e in edges if e['status'] == 'HOT'])
    cold = len([e for e in edges if e['status'] == 'COLD'])
    print(f"[NBA Props] Saved {len(edges)} players | 🔥 Hot: {hot} | ❄️ Cold: {cold}")


if __name__ == "__main__":
    calculate_prop_edges()
