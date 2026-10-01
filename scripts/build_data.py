# Daily build for the NFL simulator page. Usage:
#   python3 build_data.py YEAR games.csv stats_player_week_YEAR.csv EXPECTED_GAMES [prev_season.json]
# Writes season.json and prints CHECKS OK / CHECKS FAILED.
import csv, json, sys, datetime, os
year = sys.argv[1]; src = sys.argv[2]; qbsrc = sys.argv[3]; expected = int(sys.argv[4])
prev_path = sys.argv[5] if len(sys.argv) > 5 else None
import re
# Only well-formed values from the source ever reach the page (the page also re-checks).
TEAMS = {'ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC',
         'LA','LAC','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'}
GAME_ID = re.compile(r'^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$')
PLAYER_ID = re.compile(r'^[0-9A-Za-z-]{1,20}$')
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$'); TIME = re.compile(r'^(\d{2}:\d{2})?$')
clean_name = lambda s: re.sub(r'[^\w .\'-]', '', s or '', flags=re.UNICODE)[:40]
clean_stadium = lambda s: re.sub(r"[^A-Za-z0-9 &'.-]", '', (s or '') if s not in ('NA',) else '')[:60]
bad = []
def check_row(r):
    if r['home_team'] not in TEAMS or r['away_team'] not in TEAMS: bad.append(f"{r['game_id']}: unknown team code")
    if not GAME_ID.match(r['game_id']): bad.append(f"unexpected game id {r['game_id'][:30]!r}")
    if not DATE.match(r['gameday']) or not TIME.match(r['gametime'] if r['gametime'] not in ('NA',) else ''): bad.append(f"{r['game_id']}: unexpected date/time")
rows = [r for r in csv.DictReader(open(src)) if r['season'] == year and r['game_type'] == 'REG']
for r in rows: check_row(r)
g = []; names = {}
nz = lambda v: v if v not in ('', 'NA') else None
for r in rows:
    num = lambda k: (float(r[k]) if r[k] not in ('', 'NA') else None)
    hs, as_ = num('home_score'), num('away_score')
    aq, hq = nz(r['away_qb_id']), nz(r['home_qb_id'])
    aq = aq if aq and PLAYER_ID.match(aq) else None
    hq = hq if hq and PLAYER_ID.match(hq) else None
    if aq: names[aq] = clean_name(r['away_qb_name'])
    if hq: names[hq] = clean_name(r['home_qb_name'])
    g.append([r['game_id'], int(r['week']), r['gameday'], r['gametime'], r['away_team'], r['home_team'],
              None if as_ is None else int(as_), None if hs is None else int(hs),
              num('spread_line'), 1 if r['location'] == 'Neutral' else 0, aq, hq, clean_stadium(r.get('stadium'))])
g.sort(key=lambda x: (x[1], x[2], x[3] or '', x[0]))
# Playoff games (Wild Card through Super Bowl), once the matchups exist in the data.
ROUND = {'WC': 1, 'DIV': 2, 'CON': 3, 'SB': 4}
po = []
for r in csv.DictReader(open(src)):
    if r['season'] != year or r['game_type'] not in ROUND: continue
    check_row(r)
    hs, as_ = r['home_score'], r['away_score']
    po.append([r['game_id'], ROUND[r['game_type']], r['gameday'], r['gametime'], r['away_team'], r['home_team'],
               int(float(as_)) if as_ not in ('', 'NA') else None, int(float(hs)) if hs not in ('', 'NA') else None,
               1 if r['location'] == 'Neutral' else 0])
po.sort(key=lambda x: (x[1], x[2], x[3] or '', x[0]))
# Super Bowl site, read from the data once nflverse lists the game (about two weeks before it's played):
# the host team(s) are whoever played regular-season home games at that stadium this season.
sb_site = None
for r in csv.DictReader(open(src)):
    if r['season'] == year and r['game_type'] == 'SB' and re.match(r'^[A-Z0-9]{3,8}$', r.get('stadium_id') or ''):
        homes = sorted({x['home_team'] for x in csv.DictReader(open(src))
                        if x['season'] == year and x['game_type'] == 'REG' and x['location'] == 'Home' and x.get('stadium_id') == r['stadium_id'] and x['home_team'] in TEAMS})
        sb_site = {'stadium': clean_stadium(r.get('stadium')), 'hosts': homes}
qb = []
if os.path.exists(qbsrc) and os.path.getsize(qbsrc) > 1000:
    for r in csv.DictReader(open(qbsrc)):
        if r.get('position') != 'QB' or r.get('season_type') != 'REG' or r.get('season') != year: continue
        fl = lambda k: float(r[k]) if r[k] not in ('', 'NA') else 0.0
        plays = fl('attempts') + fl('sacks_suffered') + fl('carries')
        if plays <= 0 or not PLAYER_ID.match(r['player_id']) or not GAME_ID.match(r['game_id']): continue
        qb.append([r['game_id'], r['player_id'], int(plays), round(fl('passing_epa') + fl('rushing_epa'), 3)])
        names.setdefault(r['player_id'], clean_name(r['player_display_name']))
problems = bad[:5]
if len(g) != expected: problems.append(f'expected {expected} games, found {len(g)}')
tomorrow = (datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(days=1)).strftime('%Y-%m-%d')
for x in g:
    a, h = x[6], x[7]
    if (a is None) != (h is None): problems.append(f'{x[0]}: only one team has a score')
    if a is not None:
        if not (0 <= a <= 80 and 0 <= h <= 80): problems.append(f'{x[0]}: implausible score {a}-{h}')
        if x[2] > tomorrow: problems.append(f'{x[0]}: marked final before its date {x[2]}')
# Stale-data check: a game from the last few weeks that kicked off 2+ days ago should have its score by now.
# (Older games are left alone, so rebuilding a past season with a cancelled game still works.)
now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
recent_lo, stale_hi = (now - datetime.timedelta(days=30)).strftime('%Y-%m-%d'), (now - datetime.timedelta(days=2)).strftime('%Y-%m-%d')
stale = [x[0] for x in g + po if x[6] is None and recent_lo <= x[2] <= stale_hi]
if stale: problems.append(f'{len(stale)} game(s) played 2+ days ago still have no score (e.g. {stale[0]}); nflverse may have stopped updating, or a game was postponed')
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
out = {"season": int(year), "updatedAt": datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None).strftime('%Y-%m-%dT%H:%MZ'),
       "source": f"nflverse/nfldata games.csv + nflverse stats_player_week_{year}.csv",
       "fields": ["id", "week", "date", "time", "away", "home", "awayScore", "homeScore", "spread", "neutral", "awayQB", "homeQB", "stadium"],
       "games": g, "qbFields": ["id", "player", "plays", "epa"], "qbGames": qb, "qbNames": names,
       "playoffFields": ["id", "round", "date", "time", "away", "home", "awayScore", "homeScore", "neutral"], "playoffs": po}
if sb_site: out['sbSite'] = sb_site
# Injured regular starters. A team's regular starter is the QB with the most starts in its last 8 games of
# last season plus this season's final games. If someone else is listed to start next and the regular is
# Out or Doubtful on the injury report (or on injured reserve), the page blends in his chance of returning.
# Tested on 2012-2025 (see docs/MAINTAINING.md). Optional: any problem here leaves the list empty.
INJ_OK = re.compile(r'^[A-Za-z /,.()-]{0,40}$')
def qb_out():
    inj_path, ros_path, prev_season = os.environ.get('QB_INJURIES'), os.environ.get('QB_ROSTERS'), os.environ.get('PREV_SEASON')
    if not inj_path or not os.path.exists(inj_path): return {}
    start = {}
    for x in g:
        if x[10]: start[(x[4], x[1])] = x[10]
        if x[11]: start[(x[5], x[1])] = x[11]
    final_weeks = {(x[4], x[1]) for x in g if x[6] is not None} | {(x[5], x[1]) for x in g if x[6] is not None}
    prev_starts = {}
    if prev_season and os.path.exists(prev_season):
        ps = json.load(open(prev_season)); ps = ps.get('data', ps)
        for x in sorted(ps.get('games', []), key=lambda r: r[1]):
            for t, q in ((x[4], x[10]), (x[5], x[11])):
                if q: prev_starts.setdefault(t, []).append(q)
    inj = {}
    for r in csv.DictReader(open(inj_path)):
        if r.get('position') == 'QB' and r.get('season') == year and str(r.get('week', '')).isdigit() and r.get('season_type', 'REG') == 'REG':
            inj[(int(r['week']), r['gsis_id'])] = (r.get('report_status') or '', r.get('report_primary_injury') or '')
    ros = {}
    if ros_path and os.path.exists(ros_path):
        for r in csv.DictReader(open(ros_path)):
            if r.get('position') == 'QB' and r.get('season') == year and str(r.get('week', '')).isdigit():
                ros[(int(r['week']), r['gsis_id'])] = r.get('status') or ''
    out = {}
    for t in sorted(TEAMS):
        listed = sorted(w for (tt, w) in start if tt == t)
        if not listed: continue
        nxt = listed[-1]; cur = start[(t, nxt)]
        cnt, order = {}, {}
        for q in prev_starts.get(t, [])[-8:]: cnt[q] = cnt.get(q, 0) + 1
        for i, w in enumerate(listed):
            if (t, w) in final_weeks: cnt[start[(t, w)]] = cnt.get(start[(t, w)], 0) + 1; order[start[(t, w)]] = i
        if not cnt: continue
        reg = max(cnt, key=lambda q: (cnt[q], order.get(q, -1)))
        if reg == cur or not PLAYER_ID.match(reg): continue
        # Injury status is read for the team's next unplayed game (that week's report, or last week's if it isn't out
        # yet), not for the furthest week with a projected starter, which can be two weeks ahead.
        open_weeks = sorted({x[1] for x in g if t in (x[4], x[5]) and x[6] is None})
        if not open_weeks: continue
        wk = open_weeks[0]
        rs = ros.get((wk, reg)) or ros.get((wk - 1, reg)) or ''
        rep = inj.get((wk, reg)) or inj.get((wk - 1, reg)) or ('', '')
        if rs == 'RES': cls, status = 'ir', 'Injured reserve'
        elif rep[0] in ('Out', 'Doubtful') or (rs == 'INA' and rep[0]):
            s_ = rep[1].lower(); cls = 'head' if ('concussion' in s_ or 'head' in s_) else 'other'; status = rep[0] or 'Inactive'
        else: continue                       # not hurt: a benching or trade, so the new starter is assumed to stay
        injury = rep[1] if INJ_OK.match(rep[1] or '') else ''
        out[t] = {'qb': reg, 'cls': cls, 'status': status, 'injury': injury}
    return out
try:
    out['qbOut'] = qb_out()
    if out['qbOut']: print('Injured regular starters:', ', '.join(f"{t} {names.get(o['qb']) or o['qb']} ({o['status']}{', ' + o['injury'] if o['injury'] else ''})" for t, o in out['qbOut'].items()))
except Exception as e:
    out['qbOut'] = {}; print(f'NOTE: skipped the injured-starter check ({e}).')
# Keep the previous "updated" time when nothing else changed, so an unchanged run saves nothing.
if prev_path and os.path.exists(prev_path):
    old = json.load(open(prev_path)); old = old.get('data', old)
    if {k: v for k, v in old.items() if k != 'updatedAt'} == json.loads(json.dumps({k: v for k, v in out.items() if k != 'updatedAt'})):
        out['updatedAt'] = old.get('updatedAt', out['updatedAt']); print('No data changes since the last run.')
json.dump(out, open('season.json', 'w'), separators=(',', ':'))
lastwk = max([x[1] for x in g if x[6] is not None], default=0)
pofinal = sum(1 for x in po if x[6] is not None)
champ = ''
sb = [x for x in po if x[1] == 4 and x[6] is not None]
if sb: champ = f"| {sb[0][5] if sb[0][7] > sb[0][6] else sb[0][4]} won the Super Bowl "
print('CHECKS OK:', len(g), 'games', final, 'final', f'| {pofinal} of {len(po)} playoff games final', champ, sum(1 for x in g if x[8] is not None), 'with spread,', qbgames,
      'games with QB stats | latest completed week', lastwk, '| ALL_FINAL' if final == len(g) else '')
