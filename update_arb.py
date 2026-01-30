#!/usr/bin/env python3
"""
NFL ARBITRAGE TARGET MODEL
Based on "ARBITRAGE: Efficient Reasoning via Advantage-Aware Speculation"

Metrics:
- CROE: 3rd down conversion rate vs league average
- PROE: 2nd down pass rate vs expected

Run: python3 update_arb.py
Output: nfl_arb_data.json
"""

import json
import sys
import os

# Check dependencies
try:
    import nfl_data_py as nfl
    import pandas as pd
    import numpy as np
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Run: pip3 install nfl_data_py pandas numpy")
    # Create empty file so bot doesn't crash
    with open('nfl_arb_data.json', 'w') as f:
        json.dump([], f)
    sys.exit(0)  # Exit cleanly

# CONFIG
MIN_SAMPLE_SIZE = 50
ADVANTAGE_THRESHOLD = 0.02

def generate_arbitrage_data():
    print("[Target Model] Fetching 2025 NFL Data...")
    
    try:
        df = nfl.import_pbp_data([2025])
        if df is None or len(df) == 0:
            raise ValueError("No data returned")
        print(f"  Loaded {len(df)} plays")
    except Exception as e:
        print(f"Error fetching NFL data: {e}")
        print("Creating empty arb data file...")
        with open('nfl_arb_data.json', 'w') as f:
            json.dump([], f)
        return

    print("[Target Model] Calculating Metrics...")

    # 1. 3RD DOWN EFFICIENCY (CROE)
    try:
        third_downs = df[
            (df['down'] == 3) & 
            (df['play_type'].isin(['pass', 'run'])) & 
            (df['ydstogo'] <= 15) &
            (df['posteam'].notna())
        ].copy()

        if len(third_downs) < 100:
            print("Insufficient 3rd down data")
            with open('nfl_arb_data.json', 'w') as f:
                json.dump([], f)
            return

        third_downs['converted'] = (third_downs['yards_gained'] >= third_downs['ydstogo']).astype(int)
        
        baseline = third_downs.groupby('ydstogo')['converted'].mean().reset_index()
        baseline.columns = ['ydstogo', 'exp_conv']
        
        third_downs = third_downs.merge(baseline, on='ydstogo', how='left')
        third_downs['croe'] = third_downs['converted'] - third_downs['exp_conv']
        
        t3 = third_downs.groupby('posteam').agg(
            CROE=('croe', 'mean'), 
            third_down_plays=('play_id', 'count')
        ).reset_index()

    except Exception as e:
        print(f"Error calculating CROE: {e}")
        with open('nfl_arb_data.json', 'w') as f:
            json.dump([], f)
        return

    # 2. 2ND DOWN INTENT (PROE)
    try:
        sec_downs = df[
            (df['down'] == 2) & 
            (df['play_type'].isin(['pass', 'run'])) &
            (df['posteam'].notna())
        ].copy()

        if 'wp' in sec_downs.columns:
            sec_downs = sec_downs[sec_downs['wp'].between(0.05, 0.95)]

        if 'pass' in sec_downs.columns and 'xpass' in sec_downs.columns:
            sec_downs['proe'] = sec_downs['pass'] - sec_downs['xpass']
            t2 = sec_downs.groupby('posteam').agg(PROE=('proe', 'mean')).reset_index()
        else:
            sec_downs['is_pass'] = (sec_downs['play_type'] == 'pass').astype(int)
            league_pass_rate = sec_downs['is_pass'].mean()
            team_pass = sec_downs.groupby('posteam')['is_pass'].mean().reset_index()
            team_pass['PROE'] = team_pass['is_pass'] - league_pass_rate
            t2 = team_pass[['posteam', 'PROE']]

    except Exception as e:
        print(f"Error calculating PROE: {e}")
        with open('nfl_arb_data.json', 'w') as f:
            json.dump([], f)
        return

    # 3. MERGE & CLASSIFY
    try:
        arb = t3.merge(t2, on='posteam', how='inner')
        arb = arb[arb['third_down_plays'] >= MIN_SAMPLE_SIZE]

        def get_status(row):
            p, c = row['PROE'], row['CROE']
            if p < -ADVANTAGE_THRESHOLD and c > ADVANTAGE_THRESHOLD:
                return "SLEEPER"
            if p > ADVANTAGE_THRESHOLD and c < -ADVANTAGE_THRESHOLD:
                return "TRAP"
            if p > 0 and c > 0:
                return "KILLER"
            return "NEUTRAL"

        arb['status'] = arb.apply(get_status, axis=1)
        arb['CROE'] = (arb['CROE'] * 100).round(1)
        arb['PROE'] = (arb['PROE'] * 100).round(1)
        
        output = arb[['posteam', 'PROE', 'CROE', 'status', 'third_down_plays']].to_dict('records')
        
        with open('nfl_arb_data.json', 'w') as f:
            json.dump(output, f, indent=2)
        
        sleepers = len([t for t in output if t['status'] == 'SLEEPER'])
        traps = len([t for t in output if t['status'] == 'TRAP'])
        print(f"[Target Model] Saved {len(output)} teams | Sleepers: {sleepers} | Traps: {traps}")

    except Exception as e:
        print(f"Error in merge/classify: {e}")
        with open('nfl_arb_data.json', 'w') as f:
            json.dump([], f)


if __name__ == "__main__":
    generate_arbitrage_data()
