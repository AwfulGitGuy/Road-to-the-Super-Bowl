"""Daily refresh: rebuild the current season's data file from nflverse.

Run from anywhere:  python scripts/update.py
Exits with an error (so GitHub Actions marks the run failed and emails you) if a
download fails or the safety checks don't pass. Nothing is saved in that case.
"""
import datetime, os, shutil
from common import DATA, GAMES_URL, INJURIES_URL, ROSTERS_URL, STATS_URL, download, load, run, try_download, workdir

cfg = load('config.json')
year, games = cfg['current'], cfg['games']
today = datetime.date.today().isoformat()

# Once a month, touch a small file so GitHub sees activity and keeps the schedules on.
if datetime.date.today().day == 1:
    with open(os.path.join(DATA, 'last_check.txt'), 'w') as f:
        f.write(today + '\n')

if today > cfg.get('endDate', '9999'):
    print(f'The {year} regular season is over; nothing to refresh until the new season is set up.')
    raise SystemExit(0)

tmp = workdir()
download(GAMES_URL, os.path.join(tmp, 'games.csv'))
download(STATS_URL.format(year=year), os.path.join(tmp, 'qb.csv'), required=False)
# Injury reports and roster status, used to spot an injured regular starter. Optional: without them
# the model simply assumes the latest starter keeps playing.
env = {}
if try_download(INJURIES_URL.format(year=year), os.path.join(tmp, 'injuries.csv')): env['QB_INJURIES'] = 'injuries.csv'
if try_download(ROSTERS_URL.format(year=year), os.path.join(tmp, 'rosters.csv')): env['QB_ROSTERS'] = 'rosters.csv'
last = os.path.join(DATA, f'season-{year - 1}.json')
if os.path.exists(last): env['PREV_SEASON'] = last
prev = os.path.join(DATA, f'season-{year}.json')
args = [year, 'games.csv', 'qb.csv', games] + ([prev] if os.path.exists(prev) else [])
run('build_data.py', args, cwd=tmp, env=env)
shutil.copy(os.path.join(tmp, 'season.json'), prev)
print(f'Saved data/season-{year}.json')

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
