"""Daily refresh: rebuild the current season's data file from nflverse.

Run from anywhere:  python scripts/update.py
Exits with an error (so GitHub Actions marks the run failed and emails you) if a
download fails or the safety checks don't pass. Nothing is saved in that case.
"""
import datetime, os, shutil
from common import DATA, GAMES_URL, STATS_URL, download, load, run, workdir

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
prev = os.path.join(DATA, f'season-{year}.json')
args = [year, 'games.csv', 'qb.csv', games] + ([prev] if os.path.exists(prev) else [])
run('build_data.py', args, cwd=tmp)
shutil.copy(os.path.join(tmp, 'season.json'), prev)
print(f'Saved data/season-{year}.json')
