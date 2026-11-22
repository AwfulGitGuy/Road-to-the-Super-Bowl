"""Daily refresh: rebuild the current season's data file from nflverse.

Run from anywhere:  python scripts/update.py
Exits with an error (so GitHub Actions marks the run failed and emails you) if a
download fails or the safety checks don't pass. Nothing is saved in that case.
"""
import datetime, os, shutil
from common import DATA, GAMES_URL, latest_games_url, INJURIES_URL, ROSTERS_URL, STATS_URL, download, load, run, workdir

cfg = load('config.json')
year, games = cfg['current'], cfg['games']
today = datetime.date.today().isoformat()

if today > cfg.get('endDate', '9999'):
    print(f'The {year} regular season is over; nothing to refresh until the new season is set up.')
    raise SystemExit(0)

tmp = workdir()
download(latest_games_url(), os.path.join(tmp, 'games.csv'))
# QB stats come from a different GitHub server than the scores and change only overnight, so a failed
# download here doesn't stop the run: build_data.py keeps the stats already saved (November 2026: this file's
# server timed out for 2+ hours and held back every update).
download(STATS_URL.format(year=year), os.path.join(tmp, 'qb.csv'), required=False)
# Injury reports and roster status, used to spot an injured regular starter. Optional: without them
# the model simply assumes the latest starter keeps playing.
env = {}
if download(INJURIES_URL.format(year=year), os.path.join(tmp, 'injuries.csv'), required=False): env['QB_INJURIES'] = 'injuries.csv'
if download(ROSTERS_URL.format(year=year), os.path.join(tmp, 'rosters.csv'), required=False): env['QB_ROSTERS'] = 'rosters.csv'
last = os.path.join(DATA, f'season-{year - 1}.json')
if os.path.exists(last): env['PREV_SEASON'] = last
prev = os.path.join(DATA, f'season-{year}.json')
args = [year, 'games.csv', 'qb.csv', games] + ([prev] if os.path.exists(prev) else [])
run('build_data.py', args, cwd=tmp, env=env)
shutil.copy(os.path.join(tmp, 'season.json'), prev)
print(f'Saved data/season-{year}.json')
# A check that shouldn't hold back the save (e.g. a game with no score days later): the workflow saves the
# data first, then fails the run on this file so the usual alarm still goes off.
warn_file = os.path.join(os.path.dirname(DATA), 'run_warning.txt')
if os.path.exists(os.path.join(tmp, 'warnings.txt')): shutil.copy(os.path.join(tmp, 'warnings.txt'), warn_file)
elif os.path.exists(warn_file): os.remove(warn_file)

# The "who to root for" file (data/rooting-YEAR.json). Optional: if this step fails, the data update above
# still stands and the page simply hides that panel.
import subprocess
for label, cmd in (('rooting guide', ['node', os.path.join(os.path.dirname(__file__), 'rooting.js')]),):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        print(p.stdout.strip() or p.stderr.strip())
        if p.returncode != 0: print(f'NOTE: the {label} step failed; continuing without it.')
    except Exception as e:
        print(f'NOTE: skipped the {label} step ({e}).')
