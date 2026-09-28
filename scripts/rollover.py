# Yearly rollover for the NFL simulator page. Usage:
#   python3 rollover.py NEWYEAR games.csv stats_player_week_PREVYEAR.csv prev_priors.json prev_config.json [SB_HOSTS] [SB_VENUE]
#   SB_HOSTS: comma-separated team codes whose home stadium hosts the Super Bowl, or "none".
# Writes priors.json and config.json, prints ROLLOVER OK / ROLLOVER FAILED.
import csv, json, sys, datetime
Y = int(sys.argv[1]); P = Y - 1
games_csv, stats_csv, prev_priors_path, prev_config_path = sys.argv[2:6]
hosts = [] if len(sys.argv) < 7 or sys.argv[6].lower() in ('', 'none') else sys.argv[6].split(',')
venue = sys.argv[7] if len(sys.argv) > 7 else ''
DIV = {'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'], 'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'],
       'AFC South': ['HOU', 'IND', 'JAX', 'TEN'], 'AFC West': ['DEN', 'KC', 'LV', 'LAC'],
       'NFC East': ['DAL', 'NYG', 'PHI', 'WAS'], 'NFC North': ['CHI', 'DET', 'GB', 'MIN'],
       'NFC South': ['ATL', 'CAR', 'NO', 'TB'], 'NFC West': ['ARI', 'LA', 'SF', 'SEA']}
DIVOF = {t: d for d, ts in DIV.items() for t in ts}
TEAMS = sorted(DIVOF); TI = {t: i for i, t in enumerate(TEAMS)}; N = len(TEAMS)
QB_K, QB_MU, QB_PLAYS, QB_C, QB_SIG = 200, -0.15, 35, 0.8, 0.3
PERF = dict(k=0.08, c=0.7, hfa=2.6, cap=21)
ORDER = {'REG': 0, 'WC': 1, 'DIV': 2, 'CON': 3, 'SB': 4}
f = lambda x: None if x in ('', 'NA') else float(x)
nz = lambda v: v if v not in ('', 'NA') else None
prev = json.load(open(prev_priors_path)); prev = prev.get('data', prev)
cfg = json.load(open(prev_config_path)); cfg = cfg.get('data', cfg)
rows = list(csv.DictReader(open(games_csv)))
problems = []

def roman(n):
    out = ''
    for v, s in [(1000, 'M'), (900, 'CM'), (500, 'D'), (400, 'CD'), (100, 'C'), (90, 'XC'), (50, 'L'), (40, 'XL'), (10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')]:
        while n >= v: out += s; n -= v
    return out

# ---- checks on the finished season and the new schedule ----
pg = sorted([r for r in rows if r['season'] == str(P)], key=lambda r: (ORDER.get(r['game_type'], 9), int(r['week']), r['game_id']))
ng = [r for r in rows if r['season'] == str(Y) and r['game_type'] == 'REG']
if not any(r['game_type'] == 'SB' and f(r['home_score']) is not None for r in pg): problems.append(f'{P} Super Bowl result not in the data yet')
if not ng: problems.append(f'no {Y} regular-season schedule in the data yet')
teams_new = sorted(set(r['home_team'] for r in ng) | set(r['away_team'] for r in ng))
if ng and teams_new != TEAMS: problems.append(f'team list changed: {sorted(set(teams_new) ^ set(TEAMS))}')
per = {}
for r in ng:
    for t in (r['home_team'], r['away_team']): per[t] = per.get(t, 0) + 1
if ng and len(set(per.values())) != 1: problems.append(f'teams play different numbers of games: {sorted(set(per.values()))}')
for r in ng:
    same = DIVOF.get(r['home_team']) == DIVOF.get(r['away_team'])
    if r.get('div_game') in ('0', '1') and (r['div_game'] == '1') != same:
        problems.append(f'division alignment looks different ({r["game_id"]})'); break
if problems:
    print('ROLLOVER FAILED — do not save:'); [print(' -', p) for p in problems]; sys.exit(1)

# ---- quarterback values: last season's start-of-season values + last season's plays, then decayed ----
QB = {}
for r in csv.DictReader(open(stats_csv)):
    if r.get('position') != 'QB' or r.get('season') != str(P): continue
    fl = lambda k: float(r[k]) if r[k] not in ('', 'NA') else 0.0
    plays = fl('attempts') + fl('sacks_suffered') + fl('carries')
    if plays > 0: QB.setdefault(r['game_id'], []).append((r['player_id'], plays, fl('passing_epa') + fl('rushing_epa')))
S = {q: [v[0], v[1]] for q, v in prev.get('qb', {}).items()}
val = lambda q: QB_C * QB_PLAYS * ((S[q][0] + QB_K * QB_MU) / (S[q][1] + QB_K) if q in S else QB_MU)
lined = []
for r in pg:  # in date order; record starters' values before each regular-season game
    if r['game_type'] == 'REG' and f(r['spread_line']) is not None:
        lined.append((int(r['week']), r['home_team'], r['away_team'], f(r['spread_line']), r['location'] == 'Neutral',
                      val(nz(r['home_qb_id'])), val(nz(r['away_qb_id']))))
    for pid, pl, ep in QB.get(r['game_id'], []):
        s = S.setdefault(pid, [0.0, 0.0]); s[0] += ep; s[1] += pl
qb_prior = {q: [round(QB_SIG * v[0], 2), round(QB_SIG * v[1], 1)] for q, v in S.items() if QB_SIG * v[1] >= 5}
if len(QB) < 200: problems.append(f'only {len(QB)} games with QB stats for {P}')

# ---- market rating at the end of last season (QB split out), same fit as the page ----
def solve(A, b):
    n = len(b); M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c])); M[c], M[p] = M[p], M[c]
        for r in range(n):
            if r != c:
                fct = M[r][c] / M[c][c]
                for k in range(c, n + 1): M[r][k] -= fct * M[c][k]
    return [M[i][n] / M[i][i] for i in range(n)]
latest = max(x[0] for x in lined)
A = [[0.0] * (N + 1) for _ in range(N + 1)]; b = [0.0] * (N + 1)
for wk, h, a, sp, neu, vh, va in lined:
    w = 0.7 ** (latest - wk); x = {TI[h]: 1.0, TI[a]: -1.0}
    if not neu: x[N] = 1.0
    yv = sp - (vh - va)
    for i, xi in x.items():
        b[i] += w * xi * yv
        for j, xj in x.items(): A[i][j] += w * xi * xj
for i in range(N):
    A[i][i] += 0.1
    for j in range(N): A[i][j] += 1
A[N][N] += 4; b[N] += 4 * 1.7
sol = solve(A, b)
market = {t: round(sol[TI[t]], 3) for t in TEAMS}

# ---- score-only rating at the end of last season ----
R = {t: PERF['c'] * v for t, v in prev.get('perf', {}).items()}
for t in TEAMS: R.setdefault(t, 0.0)
for r in pg:
    hs, as_ = f(r['home_score']), f(r['away_score'])
    if hs is None: continue
    h, a = r['home_team'], r['away_team']
    pred = R[h] - R[a] + (0 if r['location'] == 'Neutral' else PERF['hfa'])
    m = max(-PERF['cap'], min(PERF['cap'], hs - as_))
    k = PERF['k'] * (1.5 if int(r['week']) <= 4 and r['game_type'] == 'REG' else 1.0)
    R[h] += k * (m - pred); R[a] -= k * (m - pred)
perf = {t: round(v, 4) for t, v in R.items()}

if problems:
    print('ROLLOVER FAILED — do not save:'); [print(' -', p) for p in problems]; sys.exit(1)
n = Y - 1965
last_date = max(r['gameday'] for r in ng)
end = (datetime.date.fromisoformat(last_date) + datetime.timedelta(days=10)).isoformat()
seasons = sorted(set(cfg.get('seasons', [])) | {Y})
config = {"current": Y, "seasons": seasons, "games": len(ng), "weeks": max(int(r['week']) for r in ng),
          "sb": {"number": n, "name": f"Super Bowl {roman(n)}", "venue": venue, "hosts": hosts},
          "endDate": end, "updatedAt": datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%MZ')}
json.dump({"season": Y, "qb": qb_prior, "perf": perf, "market": market, "sb": config["sb"], "games": config["games"], "weeks": config["weeks"]}, open('priors.json', 'w'), separators=(',', ':'))
json.dump(config, open('config.json', 'w'), separators=(',', ':'))
top = sorted(market.items(), key=lambda kv: -kv[1])[:3]
print(f'ROLLOVER OK: {Y} season, {len(ng)} games over {config["weeks"]} weeks, {config["sb"]["name"]} at {venue or "unknown venue"} '
      f'(host teams: {",".join(hosts) or "none"}), {len(qb_prior)} QBs carried over, top market ratings {top}, refresh ends {end}')
