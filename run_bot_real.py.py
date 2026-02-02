import nfl_data_py as nfl
import pandas as pd
from datetime import datetime
from nfl_vector_engine import NFLEdgeDetector 

def get_upcoming_games() -> pd.DataFrame:
    """Fetches current schedule and filters for unplayed games with lines."""
    print("Fetching LIVE schedule...")
    current_year = datetime.now().year
    
    try:
        df = nfl.import_schedules([current_year])
        # Filter: Result is Empty (Unplayed) AND Spread is Not Empty (Line exists)
        upcoming = df[df['result'].isna() & df['spread_line'].notna()]
        return upcoming
    except Exception as e:
        print(f"[Warning] Could not fetch schedule: {e}")
        return pd.DataFrame()

def analyze_market():
    # 1. Load the NFL Brain
    print("Loading NFL Vector Engine...")
    bot = NFLEdgeDetector()
    
    # 2. Get Live Data
    games_df = get_upcoming_games()
    
    if games_df.empty:
        print("\n[INFO] No upcoming games found with posted lines.")
        print("Possible reasons: Offseason, Tuesday/Wednesday (no lines yet), or API issues.")
        return

    print(f"\nFound {len(games_df)} games to analyze.")
    print("-" * 60)

    # 3. Analyze each game
    for _, row in games_df.iterrows():
        game_data = {
            'team': row['home_team'],
            'opponent': row['away_team'],
            # Placeholders for live stats (should fetch from API in production)
            'team_ppg': 24.0, 
            'team_oppg': 20.0,
            'opp_ppg': 21.0,
            'opp_oppg': 23.0,
            'is_home': True,
            'rest_diff': 0,
            'win_pct': 0.500,
            'cover_pct': 0.500,
            'spread': row['spread_line'],
            'total': row['total_line'],
            'line_move': 0,
            'week': row['week']
        }
        
        result = bot.find_edges(game_data)
        
        if result['status'] != 'NO_EDGE':
            print(f"🏈 {row['home_team']} vs {row['away_team']} (Week {row['week']})")
            print(f"   Lines: {row['spread_line']} / {row['total_line']}")
            
            top_edge = result['edges'][0]
            confidence = top_edge.get('confidence', 0)
            indicator = "🔥" if confidence > 0.7 else "👀"
            
            print(f"   {indicator} Signal: {top_edge['type']} {top_edge['direction']}")
            print(f"      Edge: {top_edge['edge']}% | Hist. Win Rate: {top_edge['win_rate']}%")
            print(f"      Confidence: {confidence:.2f} (Sample: {result['sample_size']} games)")
            print("-" * 60)

if __name__ == "__main__":
    analyze_market()