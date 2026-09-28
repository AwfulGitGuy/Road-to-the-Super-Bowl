# Daily build for the NFL simulator page. Usage:
#   python3 build_data.py YEAR games.csv stats_player_week_YEAR.csv EXPECTED_GAMES [prev_season.json]
# Writes season.json and prints CHECKS OK / CHECKS FAILED.
import csv, json, sys, datetime, os
year = sys.argv[1]; src = sys.argv[2]; qbsrc = sys.argv[3]; expected = int(sys.argv[4])
prev_path = sys.argv[5] if len(sys.argv) > 5 else None
rows = [r for r in csv.DictReader(open(src)) if r['season'] == year and r['game_type'] == 'REG']
g = []; names = {}
nz = lambda v: v if v not in ('', 'NA') else None
for r in rows:
    num = lambda k: (float(r[k]) if r[k] not in ('', 'NA') else None)
    hs, as_ = num('home_score'), num('away_score')
    aq, hq = nz(r['away_qb_id']), nz(r['home_qb_id'])
    if aq: names[aq] = r['away_qb_name']
    if hq: names[hq] = r['home_qb_name']
    g.append([r['game_id'], int(r['week']), r['gameday'], r['gametime'], r['away_team'], r['home_team'],
              None if as_ is None else int(as_), None if hs is None else int(hs),
              num('spread_line'), 1 if r['location'] == 'Neutral' else 0, aq, hq])
g.sort(key=lambda x: (x[1], x[2], x[3] or '', x[0]))
# Playoff games (Wild Card through Super Bowl), once the matchups exist in the data.
ROUND = {'WC': 1, 'DIV': 2, 'CON': 3, 'SB': 4}
po = []
for r in csv.DictReader(open(src)):
    if r['season'] != year or r['game_type'] not in ROUND: continue
    hs, as_ = r['home_score'], r['away_score']
    po.append([r['game_id'], ROUND[r['game_type']], r['gameday'], r['gametime'], r['away_team'], r['home_team'],
               int(float(as_)) if as_ not in ('', 'NA') else None, int(float(hs)) if hs not in ('', 'NA') else None,
               1 if r['location'] == 'Neutral' else 0])
po.sort(key=lambda x: (x[1], x[2], x[3] or '', x[0]))
qb = []
if os.path.exists(qbsrc) and os.path.getsize(qbsrc) > 1000:
    for r in csv.DictReader(open(qbsrc)):
        if r.get('position') != 'QB' or r.get('season_type') != 'REG' or r.get('season') != year: continue
        fl = lambda k: float(r[k]) if r[k] not in ('', 'NA') else 0.0
        plays = fl('attempts') + fl('sacks_suffered') + fl('carries')
        if plays <= 0: continue
        qb.append([r['game_id'], r['player_id'], int(plays), round(fl('passing_epa') + fl('rushing_epa'), 3)])
        names.setdefault(r['player_id'], r['player_display_name'])
problems = []
if len(g) != expected: problems.append(f'expected {expected} games, found {len(g)}')
tomorrow = (datetime.datetime.utcnow() + datetime.timedelta(days=1)).strftime('%Y-%m-%d')
for x in g:
    a, h = x[6], x[7]
    if (a is None) != (h is None): problems.append(f'{x[0]}: only one team has a score')
    if a is not None:
        if not (0 <= a <= 80 and 0 <= h <= 80): problems.append(f'{x[0]}: implausible score {a}-{h}')
        if x[2] > tomorrow: problems.append(f'{x[0]}: marked final before its date {x[2]}')
final = sum(1 for x in g if x[6] is not None)
qbgames = len(set(r[0] for r in qb))
if final >= 16 and qbgames < final * 0.8: problems.append(f'QB stats cover only {qbgames} of {final} final games')
if prev_path and os.path.exists(prev_path):
    prev = json.load(open(prev_path)); prev = prev.get('data', prev)
    pf = {r[0]: (r[6], r[7]) for r in prev.get('games', []) if r[6] is not None}
    cur = {x[0]: (x[6], x[7]) for x in g}
    lost = [k for k in pf if cur.get(k, (None, None))[0] is None]
    if lost: problems.append(f'{len(lost)} previously final game(s) lost their scores, e.g. {lost[0]}')
    if final < len(pf): problems.append(f'final games dropped from {len(pf)} to {final}')
    changed = [k for k in pf if k in cur and cur[k][0] is not None and cur[k] != pf[k]]
    if changed: print(f'NOTE: {len(changed)} final score(s) were corrected upstream, e.g. {changed[0]} {pf[changed[0]]} -> {cur[changed[0]]}')
if problems:
    print('CHECKS FAILED — do not save:'); [print(' -', p) for p in problems[:10]]; sys.exit(1)
out = {"season": int(year), "updatedAt": datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%MZ'),
       "source": f"nflverse/nfldata games.csv + nflverse stats_player_week_{year}.csv",
       "fields": ["id", "week", "date", "time", "away", "home", "awayScore", "homeScore", "spread", "neutral", "awayQB", "homeQB"],
       "games": g, "qbFields": ["id", "player", "plays", "epa"], "qbGames": qb, "qbNames": names,
       "playoffFields": ["id", "round", "date", "time", "away", "home", "awayScore", "homeScore", "neutral"], "playoffs": po}
json.dump(out, open('season.json', 'w'), separators=(',', ':'))
pit = [x for x in g if x[6] is not None and 'PIT' in (x[4], x[5])]
w = sum(1 for x in pit if (x[5] == 'PIT' and x[7] > x[6]) or (x[4] == 'PIT' and x[6] > x[7]))
l = sum(1 for x in pit if (x[5] == 'PIT' and x[7] < x[6]) or (x[4] == 'PIT' and x[6] < x[7]))
lastwk = max([x[1] for x in g if x[6] is not None], default=0)
pofinal = sum(1 for x in po if x[6] is not None)
champ = ''
sb = [x for x in po if x[1] == 4 and x[6] is not None]
if sb: champ = f"| {sb[0][5] if sb[0][7] > sb[0][6] else sb[0][4]} won the Super Bowl "
print('CHECKS OK:', len(g), 'games', final, 'final', f'| {pofinal} of {len(po)} playoff games final', champ, sum(1 for x in g if x[8] is not None), 'with spread,', qbgames,
      'games with QB stats | latest completed week', lastwk, '| Steelers', f'{w}-{l}', '| ALL_FINAL' if final == len(g) else '')
