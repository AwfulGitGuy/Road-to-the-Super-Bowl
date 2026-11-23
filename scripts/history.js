// The week-by-week odds behind the page's history chart (data/history-YEAR.json), computed once here instead of
// in every visitor's browser. Same model code, simulations and seeds as the page, so the numbers are identical.
// Skips the work when the file already matches the current season data.
// Usage: node scripts/history.js                     (current season; prints a one-line summary)
//        node scripts/history.js YEAR                (another season with files in data/)
//        node scripts/history.js SEASON.json PRIORS.json OUT.json   (for testing on other data)
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), DATA = path.join(ROOT, 'data');
const M = require(path.join(ROOT, 'src', 'model.js'));
const cfg = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json')));
const args = process.argv.slice(2);
const yr = args.length === 1 ? +args[0] : cfg.current;
const sPath = args.length === 3 ? args[0] : path.join(DATA, `season-${yr}.json`);
const pPath = args.length === 3 ? args[1] : path.join(DATA, `priors-${yr}.json`);
const season = JSON.parse(fs.readFileSync(sPath)), pri = JSON.parse(fs.readFileSync(pPath));
const year = season.season || yr;
const out = args.length === 3 ? args[2] : path.join(DATA, `history-${year}.json`);
const SIMS = 2000;
if (fs.existsSync(out)) {
  try { const old = JSON.parse(fs.readFileSync(out)); if (old.basedOn === season.updatedAt && old.sims === SIMS) { console.log('History: up to date.'); process.exit(0); } } catch (e) {}
}
// Same options the page passes (src/app.js, job()): starting values, and the Super Bowl host team(s).
const sbHosts = (season.sbSite && Array.isArray(season.sbSite.hosts) ? season.sbSite.hosts : (pri.sb || (year === cfg.current ? cfg.sb : null) || {}).hosts) || [];
const h = M.history(season, { qbPrior: pri.qb, marketPrior: pri.market, sbHosts, sims: SIMS });
const scale = x => Math.round(x * 1000);
const doc = { season: year, basedOn: season.updatedAt, sims: SIMS, scale: 1000, fields: ['playoff', 'divWin', 'sbWin'],
  weeks: h.map(w => ({ week: w.week, teams: Object.fromEntries(Object.entries(w.teams).map(([t, v]) => [t, v.map(scale)])) })) };
const text = JSON.stringify(doc);
if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) fs.writeFileSync(out, text);
console.log(`History: ${doc.weeks.length} points (through week ${doc.weeks[doc.weeks.length - 1].week}), based on data from ${season.updatedAt}.`);
