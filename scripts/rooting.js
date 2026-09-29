// "Who to root for": for each game in the next week with unplayed games, play the same 10,000 seasons twice
// (once with each result) and record every team's chances. Pairing the runs this way means the only
// difference between them is that one game, so even half-point effects are reliable.
// Usage: node scripts/rooting.js   (writes data/rooting-YEAR.json; prints a one-line summary)
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), DATA = path.join(ROOT, 'data');
const M = require(path.join(ROOT, 'src', 'model.js'));
const cfg = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json')));
const year = cfg.current;
const season = JSON.parse(fs.readFileSync(path.join(DATA, `season-${year}.json`)));
const pri = JSON.parse(fs.readFileSync(path.join(DATA, `priors-${year}.json`)));
const SIMS = 10000;
const opts = { sims: SIMS, qbPrior: pri.qb, marketPrior: pri.market, sbHosts: (season.sbSite && season.sbSite.hosts) || ((pri.sb || cfg.sb || {}).hosts) || [] };
const out = path.join(DATA, `rooting-${year}.json`);
const base = M.simulate(season, opts);
if (!base.upcoming.length) { if (fs.existsSync(out)) fs.unlinkSync(out); console.log('Rooting guide: regular season complete, nothing to do.'); process.exit(0); }
const week = Math.min(...base.upcoming.map(g => g.week));
const per = r => Object.fromEntries(r.teams.map(t => [t.abbr, [t.playoff, t.divWin, t.bye].map(x => Math.round(x * 1000))]));
const games = base.upcoming.filter(g => g.week === week).map(g => {
  const h = M.simulate(season, { ...opts, picks: { [g.id]: g.home } }), a = M.simulate(season, { ...opts, picks: { [g.id]: g.away } });
  return { id: g.id, away: g.away, home: g.home, pHome: Math.round(g.pHome * 1000), ifHome: per(h), ifAway: per(a) };
});
const doc = { season: year, basedOn: season.updatedAt, week, sims: SIMS, scale: 1000, base: per(base), games };
const text = JSON.stringify(doc);
if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) fs.writeFileSync(out, text);
console.log(`Rooting guide: week ${week}, ${games.length} games, based on data from ${season.updatedAt}.`);
