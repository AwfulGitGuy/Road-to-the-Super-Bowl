"""Yearly rollover: set up the next season once its schedule is published.

Run from anywhere:  python scripts/new_season.py
- Does nothing (and succeeds) if next season's schedule isn't out yet.
- Reads the Super Bowl venue from data/super_bowl_hosts.json (add each new season's entry).
- Stops with an error, saving nothing, if the league's format looks different
  (team list, games per team, divisions) so the page can be updated first.
"""
import csv, json, os, shutil
from common import DATA, GAMES_URL, STATS_URL, download, load, run, workdir

cfg = load('config.json')
prev_year = cfg['current']; year = prev_year + 1
tmp = workdir()
download(GAMES_URL, os.path.join(tmp, 'games.csv'))
rows = [r for r in csv.DictReader(open(os.path.join(tmp, 'games.csv'))) if r['season'] == str(year) and r['game_type'] == 'REG']
if not rows:
    print(f'The {year} schedule is not published yet; nothing to do.')
    raise SystemExit(0)

hosts_file = load('super_bowl_hosts.json')
sb = hosts_file.get(str(year), {})
hosts = ','.join(sb.get('hosts', [])) or 'none'
venue = sb.get('venue', '')
if not sb:
    print(f'NOTE: no Super Bowl venue listed for {year} in data/super_bowl_hosts.json; treating it as a neutral site.')

download(STATS_URL.format(year=prev_year), os.path.join(tmp, 'stats_prev.csv'))
shutil.copy(os.path.join(DATA, 'config.json'), os.path.join(tmp, 'config_prev.json'))
run('rollover.py', [year, 'games.csv', 'stats_prev.csv', os.path.join(DATA, f'priors-{prev_year}.json'), 'config_prev.json', hosts, venue], cwd=tmp)

new_cfg = json.load(open(os.path.join(tmp, 'config.json')))
download(STATS_URL.format(year=year), os.path.join(tmp, 'qb.csv'), required=False)
run('build_data.py', [year, 'games.csv', 'qb.csv', new_cfg['games']], cwd=tmp)

shutil.copy(os.path.join(tmp, 'priors.json'), os.path.join(DATA, f'priors-{year}.json'))
shutil.copy(os.path.join(tmp, 'season.json'), os.path.join(DATA, f'season-{year}.json'))
shutil.copy(os.path.join(tmp, 'config.json'), os.path.join(DATA, 'config.json'))
print(f'Set up the {year} season: data/config.json, data/priors-{year}.json, data/season-{year}.json')
