// Model checks on the committed 2025 season (no network). Run: node tests/test_model.js
const assert = require('assert'), fs = require('fs'), path = require('path');
const M = require('../src/model.js');
const D = p => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', p)));
const pri = D('priors-2025.json'), full = D('season-2025.json');
const opts = { sims: 4000, qbPrior: pri.qb, marketPrior: pri.market, sbHosts: ['SF'] };
const sum = (r, k) => r.teams.reduce((a, t) => a + t[k], 0);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const clone = x => JSON.parse(JSON.stringify(x));
let n = 0; const test = (name, f) => { f(); n++; console.log('ok -', name); };

test('mid-season (after Week 10): probabilities are consistent', () => {
  const s = clone(full); const ix = Object.fromEntries(s.fields.map((k, i) => [k, i]));
  for (const g of s.games) if (g[ix.week] > 10) { g[ix.awayScore] = null; g[ix.homeScore] = null; }
  s.playoffs = [];
  const r = M.simulate(s, opts);
  near(sum(r, 'playoff'), 14, 0.01, 'playoff spots');
  near(sum(r, 'divWin'), 8, 0.01, 'division winners');
  near(sum(r, 'bye'), 2, 0.01, 'byes');
  near(sum(r, 'sbWin'), 1, 0.001, 'Super Bowl winners');
  for (const t of r.teams) for (const k of ['playoff', 'divWin', 'bye', 'sbWin']) assert.ok(t[k] >= 0 && t[k] <= 1, `${t.abbr} ${k}`);
  assert.ok(r.upcoming.length > 100, 'games left to play');
});

test('same data gives the same numbers (fixed seed)', () => {
  const a = M.simulate(full, { ...opts, sims: 1000 }), b = M.simulate(full, { ...opts, sims: 1000 });
  assert.deepStrictEqual(a.teams.map(t => t.sbWin), b.teams.map(t => t.sbWin));
});

test('finished season: the real champion wins every simulation', () => {
  const r = M.simulate(full, opts);
  assert.strictEqual(r.teams.find(t => t.sbWin === 1).abbr, 'SEA');
  assert.strictEqual(r.teams.filter(t => t.playoff === 1).length, 14);
});

test('playoffs with the Wild Card round pending: 14 teams alive, odds add up', () => {
  const s = clone(full); const px = Object.fromEntries(s.playoffFields.map((k, i) => [k, i]));
  s.playoffs = s.playoffs.filter(r => r[px.round] === 1).map(r => { r[px.awayScore] = null; r[px.homeScore] = null; return r; });
  const r = M.simulate(s, opts);
  assert.strictEqual(r.teams.filter(t => t.sbWin > 0).length, 14);
  near(sum(r, 'sbWin'), 1, 0.001, 'Super Bowl winners');
});

test('playoff starter: a rested Week 18 starter (qbPO) is used, and listed playoff QBs win over it', () => {
  const s = clone(full); const ix = Object.fromEntries(s.fields.map((k, i) => [k, i]));
  s.playoffs = [];
  const buf17 = s.games.find(g => g[ix.week] === 17 && (g[ix.home] === 'BUF' || g[ix.away] === 'BUF'));
  const allen = buf17[ix.home] === 'BUF' ? buf17[ix.homeQB] : buf17[ix.awayQB];
  const before = M.simulate(s, opts).teams.find(t => t.abbr === 'BUF');
  assert.notStrictEqual(before.qbId, allen, 'without qbPO the Week 18 backup is used');
  s.qbPO = { BUF: allen };
  const after = M.simulate(s, opts).teams.find(t => t.abbr === 'BUF');
  assert.strictEqual(after.qbId, allen);
  assert.ok(after.sbWin > before.sbWin * 2, `Allen should raise Buffalo's odds a lot (${before.sbWin} -> ${after.sbWin})`);
  // A QB listed for a playoff game takes precedence over qbPO.
  s.playoffFields = [...s.playoffFields, 'awayQB', 'homeQB'];
  s.playoffs = [['2025_19_BUF_JAX', 1, '2026-01-11', '13:00', 'BUF', 'JAX', null, null, 0, before.qbId, null]];
  assert.strictEqual(M.simulate(s, opts).teams.find(t => t.abbr === 'BUF').qbId, before.qbId);
});

test('tiebreakers: 2021-2025 playoff fields and byes match the real ones', () => {
  for (const y of [2021, 2022, 2023, 2024, 2025]) {
    const s = D(`season-${y}.json`), pr = D(`priors-${y}.json`);
    const px = Object.fromEntries(s.playoffFields.map((k, i) => [k, i]));
    const real = new Set(s.playoffs.filter(r => r[px.round] === 1).flatMap(r => [r[px.away], r[px.home]]));
    const div = new Set(s.playoffs.filter(r => r[px.round] === 2).flatMap(r => [r[px.away], r[px.home]]));
    const byes = [...div].filter(t => !real.has(t)).sort();
    const r = M.simulate({ ...s, playoffs: [] }, { sims: 200, qbPrior: pr.qb, marketPrior: pr.market });
    const made = r.teams.filter(t => t.playoff > 0.999).map(t => t.abbr);
    const sim = new Set([...real, ...byes]);
    assert.deepStrictEqual(made.sort(), [...sim].sort(), `${y} playoff field`);
    assert.deepStrictEqual(r.teams.filter(t => t.bye > 0.999).map(t => t.abbr).sort(), byes, `${y} byes`);
  }
});

console.log(`${n} model tests passed`);
