import nfl_data_py as nfl
import pandas as pd
import json

# CONFIGURATION
# We fetch 2025 to get the most recent "Course Conditions" (Current Season Identity)
YEARS_TO_FETCH = [2025]
MIN_SAMPLE_SIZE = 50  # Filter out backup QBs/small samples

def generate_arbitrage_data():
    print(f"🏈 [Target Model] Fetching NFL Play-by-Play Data for {YEARS_TO_FETCH}...")
    
    try:
        # 1. FETCH THE COURSE DATA
        # This pulls every single play from the 2025 season
        df = nfl.import_pbp_data(YEARS_TO_FETCH)
    except Exception as e:
        print(f"❌ Error fetching data: {e}")
        return

    print("📊 [Target Model] Calculating Team Efficiency (Advantage)...")

    # --- 2. CALCULATE 3RD DOWN CROE (The Execution) ---
    # "Conversion Rate Over Expected"
    # The Market assumes a 3rd & 7 is always hard. 
    # The Target Model checks if a specific team (e.g., Seahawks) converts it more often than average.

    # Filter: 3rd Down, Neutral Game Script (No Garbage Time), Valid Plays
    third_downs = df[
        (df['down'] == 3) & 
        (df['play_type'].isin(['pass', 'run'])) & 
        (df['ydstogo'] <= 15) &
        (df['wp'].between(0.05, 0.95))
    ].copy()

    # Did they convert?
    third_downs['converted'] = third_downs['yards_gained'] >= third_downs['ydstogo']

    # Calculate League Baseline for EVERY distance (1 to 15 yards)
    # This acts as the "Draft Model" (Market Standard)
    baseline = third_downs.groupby('ydstogo')['converted'].mean().reset_index().rename(columns={'converted': 'exp_conv'})

    # Calculate Advantage (Delta)
    third_downs = third_downs.merge(baseline, on='ydstogo', how='left')
    third_downs['croe'] = third_downs['converted'] - third_downs['exp_conv']

    t3 = third_downs.groupby('posteam').agg(
        CROE=('croe', 'mean'), 
        Count=('play_id', 'count')
    ).reset_index()

    # --- 3. CALCULATE 2ND DOWN PROE (The Setup) ---
    # "Pass Rate Over Expected"
    # Does the team attack (Pass) or settle (Run) on 2nd down?
    
    sec_downs = df[
        (df['down'] == 2) & 
        (df['play_type'].isin(['pass', 'run'])) & 
        (df['wp'].between(0.05, 0.95))
    ].copy()

    sec_downs['proe'] = sec_downs['pass'] - sec_downs['xpass']
    t2 = sec_downs.groupby('posteam').agg(PROE=('proe', 'mean')).reset_index()

    # --- 4. MERGE & CLASSIFY ---
    arb = t3.merge(t2, on='posteam')
    arb = arb[arb['Count'] > MIN_SAMPLE_SIZE]

    # The Paper's "Router" Logic:
    def get_status(row):
        p, c = row['PROE'], row['CROE']
        # SLEEPER: Passive Setup (Run) + Elite Execution (High Conversion). Market price is too low.
        if p < -0.02 and c > 0.02: return "SLEEPER"
        # TRAP: Aggressive Setup (Pass) + Poor Execution (Low Conversion). Market price is too high.
        if p > 0.02 and c < -0.02: return "TRAP"
        # KILLER: Aggressive + Elite. Priced correctly.
        if p > 0 and c > 0: return "KILLER"
        return "NEUTRAL"

    arb['status'] = arb.apply(get_status, axis=1)
    
    # Format for display
    arb['CROE'] = (arb['CROE'] * 100).round(1)
    arb['PROE'] = (arb['PROE'] * 100).round(1)

    # Filter for just the teams you asked about (Optional - remove to see all)
    # focus_teams = arb[arb['posteam'].isin(['SEA', 'NE'])]
    # print("\n--- SEAHAWKS & PATRIOTS REPORT ---")
    # print(focus_teams[['posteam', 'PROE', 'CROE', 'status']])

    # Save EVERYTHING to JSON for the Bot
    arb.to_json('nfl_arb_data.json', orient='records')
    print(f"✅ [Target Model] Saved {len(arb)} team profiles to nfl_arb_data.json")

if __name__ == "__main__":
    generate_arbitrage_data()