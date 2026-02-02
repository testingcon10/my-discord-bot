import nfl_data_py as nfl
import pandas as pd
from datetime import datetime
from nfl_vector_engine import NFLEdgeDetector 

def get_upcoming_nfl_games():
    """Fetches this week's games with betting lines"""
    print("Fetching upcoming NFL schedule...")
    current_year = datetime.now().year
    
    # Get schedule for current season
    df = nfl.import_schedules([current_year])
    
    # Filter for games that haven't happened yet (result is null)
    # AND have a spread line available
    upcoming = df[df['result'].isna() & df['spread_line'].notna()].copy()
    
    if upcoming.empty:
        print("No upcoming games found with lines! (Are we in the offseason?)")
        return []

    games_to_analyze = []
    
    # Convert NFL data into our Feature Vector format
    for _, row in upcoming.iterrows():
        # NOTE: In a real system, you'd calculate these stats dynamically 
        # from play-by-play data. For now, we use season averages as placeholders.
        
        game_context = {
            'team': row['home_team'],
            'opponent': row['away_team'],
            # Placeholders - You would normally fetch these from a stats DB
            'team_ppg': 24.5, 
            'team_oppg': 20.2,
            'opp_ppg': 21.0,
            'opp_oppg': 23.5,
            'is_home': True,
            'rest_diff': 0,
            'win_pct': 0.600,
            'cover_pct': 0.550,
            # Real Market Data
            'spread': row['spread_line'],
            'total': row['total_line'],
            'line_move': 0,
            # Metadata for display
            'week': row['week'],
            'moneyline': row.get('moneyline', -110)
        }
        games_to_analyze.append(game_context)
        
    return games_to_analyze

if __name__ == "__main__":
    # 1. Load the REAL NFL Brain
    print("Loading NFL Vector Engine...")
    bot = NFLEdgeDetector() # Automatically loads the real history you saved
    
    # 2. Get REAL Upcoming Games
    live_games = get_upcoming_nfl_games()
    
    print(f"\nAnalyzing {len(live_games)} upcoming games...")
    
    # 3. Find Edges
    for game in live_games:
        result = bot.find_edges(game)
        
        if result['status'] != 'NO_EDGE':
            print(f"\n🏈 {game['team']} vs {game['opponent']} (Week {game['week']})")
            print(f"   Line: {game['spread']} | Total: {game['total']}")
            print(f"   Status: {result['status']} (Confidence: {result['edges'][0]['confidence']:.2f})")
            for edge in result['edges']:
                print(f"   👉 {edge['type']}: {edge['direction']} ({edge['edge']}% edge)")