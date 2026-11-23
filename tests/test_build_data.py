"""Checks on scripts/build_data.py, using files rebuilt from the committed 2025 season (no network).
Run: python3 tests/test_build_data.py"""
import csv, json, os, subprocess, sys, tempfile, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEASON = json.load(open(os.path.join(ROOT, 'data', 'season-2025.json')))
ROUND = {1: 'WC', 2: 'DIV', 3: 'CON', 4: 'SB'}
GCOLS = ['season', 'game_type', 'game_id', 'week', 'gameday', 'gametime', 'away_team', 'home_team', 'away_score', 'home_score',
         'spread_line', 'location', 'away_qb_id', 'home_qb_id', 'away_qb_name', 'home_qb_name', 'stadium', 'stadium_id', 'div_game']
SCOLS = ['season', 'season_type', 'position', 'game_id', 'player_id', 'player_display_name', 'attempts', 'sacks_suffered', 'carries', 'passing_epa', 'rushing_epa']

def games_rows(edit=None):
    ix = {k: i for i, k in enumerate(SEASON['fields'])}; px = {k: i for i, k in enumerate(SEASON['playoffFields'])}
    nm = SEASON['qbNames']; na = lambda v: 'NA' if v is None else v
    rows = [{'season': '2025', 'game_type': 'REG', 'game_id': g[ix['id']], 'week': g[ix['week']], 'gameday': g[ix['date']], 'gametime': g[ix['time']],
             'away_team': g[ix['away']], 'home_team': g[ix['home']], 'away_score': na(g[ix['awayScore']]), 'home_score': na(g[ix['homeScore']]),
             'spread_line': na(g[ix['spread']]), 'location': 'Neutral' if g[ix['neutral']] else 'Home',
             'away_qb_id': g[ix['awayQB']] or 'NA', 'home_qb_id': g[ix['homeQB']] or 'NA', 'away_qb_name': nm.get(g[ix['awayQB']], 'NA'),
             'home_qb_name': nm.get(g[ix['homeQB']], 'NA'), 'stadium': 'NA', 'stadium_id': 'NA', 'div_game': 'NA'} for g in SEASON['games']]
    rows += [{'season': '2025', 'game_type': ROUND[r[px['round']]], 'game_id': r[px['id']], 'week': int(r[px['id']][5:7]), 'gameday': r[px['date']],
              'gametime': r[px['time']], 'away_team': r[px['away']], 'home_team': r[px['home']], 'away_score': r[px['awayScore']], 'home_score': r[px['homeScore']],
              'spread_line': 'NA', 'location': 'Neutral' if r[px['neutral']] else 'Home', 'away_qb_id': 'NA', 'home_qb_id': 'NA', 'away_qb_name': 'NA',
              'home_qb_name': 'NA', 'stadium': 'NA', 'stadium_id': 'NA', 'div_game': 'NA'} for r in SEASON['playoffs']]
    if edit: edit(rows)
    return rows

def build(rows, extra_env=None):
    d = tempfile.mkdtemp(prefix='bd-test-')
    with open(os.path.join(d, 'games.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=GCOLS); w.writeheader(); w.writerows(rows)
    with open(os.path.join(d, 'qb.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=SCOLS); w.writeheader()
        for gid, pid, plays, epa in SEASON['qbGames']:
            w.writerow({'season': '2025', 'season_type': 'REG', 'position': 'QB', 'game_id': gid, 'player_id': pid, 'player_display_name': SEASON['qbNames'].get(pid, 'X'),
                        'attempts': plays, 'sacks_suffered': 0, 'carries': 0, 'passing_epa': epa, 'rushing_epa': 0})
    env = {k: v for k, v in os.environ.items() if k not in ('QB_INJURIES', 'QB_ROSTERS', 'PREV_SEASON', 'ACCEPT_SCORE_CHANGES')}
    env.update(extra_env or {})
    p = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'scripts', 'build_data.py'), '2025', 'games.csv', 'qb.csv', '272'],
                       cwd=d, capture_output=True, text=True, env=env)
    sp = os.path.join(d, 'season.json')
    out = None
    if os.path.exists(sp):
        with open(sp) as f: out = json.load(f)
    return p, out, d

class BuildData(unittest.TestCase):
    def test_round_trip(self):
        p, out, _ = build(games_rows())
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn('CHECKS OK', p.stdout)
        keep = len(SEASON['fields'])
        self.assertEqual([g[:keep] for g in out['games']], sorted(SEASON['games'], key=lambda x: (x[1], x[2], x[3] or '', x[0])))
        self.assertEqual(len(out['playoffs']), len(SEASON['playoffs']))
        self.assertEqual(sorted(map(tuple, out['qbGames'])), sorted(map(tuple, SEASON['qbGames'])))

    def test_bad_spread_is_rejected(self):
        def edit(rows): rows[100]['spread_line'] = 'NaN'; rows[101]['spread_line'] = '1e9'
        p, out, _ = build(games_rows(edit))
        self.assertNotEqual(p.returncode, 0); self.assertIn('bad spread_line', p.stdout); self.assertIsNone(out)

    def test_unknown_team_is_rejected(self):
        def edit(rows): rows[5]['home_team'] = 'XXX'
        p, out, _ = build(games_rows(edit))
        self.assertNotEqual(p.returncode, 0); self.assertIn('unknown team', p.stdout)

    def test_missing_game_is_rejected(self):
        p, out, _ = build(games_rows(lambda rows: rows.pop(3)))
        self.assertNotEqual(p.returncode, 0); self.assertIn('expected 272 games', p.stdout)

    def test_output_is_valid_json(self):
        p, out, d = build(games_rows())
        def reject(c): raise ValueError(f'non-standard JSON value {c}')
        with open(os.path.join(d, 'season.json')) as f: json.loads(f.read(), parse_constant=reject)   # no NaN/Infinity

if __name__ == '__main__':
    unittest.main(verbosity=2)
