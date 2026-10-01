// "Who to root for": for each game in the coming week (or each scheduled playoff game), play the same 10,000
// seasons twice, once with each result, and record every team's chances. Pairing the runs this way means the
// only difference between them is that one game, so even half-point effects are reliable.
// Usage: node scripts/rooting.js            (writes data/rooting-YEAR.json; prints a one-line summary)
//        node scripts/rooting.js SEASON.json PRIORS.json OUT.json   (for testing on other data)
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), DATA = path.join(ROOT, 'data');
const M = require(path.join(ROOT, 'src', 'model.js'));
const cfg = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json')));
const [sArg, pArg, oArg] = process.argv.slice(2);
const season = JSON.parse(fs.readFileSync(sArg || path.join(DATA, `season-${cfg.current}.json`)));
const pri = JSON.parse(fs.readFileSync(pArg || path.join(DATA, `priors-${cfg.current}.json`)));
const year = season.season || cfg.current;
const out = oArg || path.join(DATA, `rooting-${year}.json`);
const SIMS = 10000;
const opts = { sims: SIMS, qbPrior: pri.qb, marketPrior: pri.market, sbHosts: (season.sbSite && season.sbSite.hosts) || ((pri.sb || cfg.sb || {}).hosts) || [] };
const write = doc => { const text = JSON.stringify(doc); if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) fs.writeFileSync(out, text); };
const base = M.simulate(season, opts);
const scale = x => Math.round(x * 1000);
let doc;
if (base.upcoming.length) {
  // Regular season: the next week with unplayed games.
  const goals = ['playoff', 'div', 'bye', 'sb'];
  const per = r => Object.fromEntries(r.teams.map(t => [t.abbr, [t.playoff, t.divWin, t.bye, t.sbWin].map(scale)]));
  const week = Math.min(...base.upcoming.map(g => g.week));
  const games = base.upcoming.filter(g => g.week === week).map(g => {
    const h = M.simulate(season, { ...opts, picks: { [g.id]: g.home } }), a = M.simulate(season, { ...opts, picks: { [g.id]: g.away } });
    return { id: g.id, away: g.away, home: g.home, pHome: scale(g.pHome), ifHome: per(h), ifAway: per(a) };
  });
  doc = { season: year, basedOn: season.updatedAt, phase: 'regular', week, goals, sims: SIMS, scale: 1000, base: per(base), games };
} else {
  // Playoffs: every scheduled playoff game whose two teams are known and that hasn't been played.
  const goals = ['conf', 'sb'];
  const per = r => Object.fromEntries(r.teams.map(t => [t.abbr, [t.confWin, t.sbWin].map(scale)]));
  const fx = season.playoffFields ? Object.fromEntries(season.playoffFields.map((k, i) => [k, i])) : null;
  const pending = fx ? (season.playoffs || []).filter(r => r[fx.homeScore] === null && M.TEAMS.includes(r[fx.away]) && M.TEAMS.includes(r[fx.home])) : [];
  if (!pending.length) { if (fs.existsSync(out)) fs.unlinkSync(out); console.log('Rooting guide: no games left to root for.'); process.exit(0); }
  const round = Math.min(...pending.map(r => r[fx.round]));
  const games = pending.filter(r => r[fx.round] === round).map(r => {
    const id = r[fx.id], away = r[fx.away], home = r[fx.home];
    const h = M.simulate(season, { ...opts, poPicks: { [id]: home } }), a = M.simulate(season, { ...opts, poPicks: { [id]: away } });
    return { id, away, home, pHome: null, ifHome: per(h), ifAway: per(a) };
  });
  doc = { season: year, basedOn: season.updatedAt, phase: 'playoffs', round, goals, sims: SIMS, scale: 1000, base: per(base), games };
}
write(doc);
console.log(`Rooting guide: ${doc.phase === 'regular' ? 'week ' + doc.week : 'playoff round ' + doc.round}, ${doc.games.length} games, based on data from ${season.updatedAt}.`);
