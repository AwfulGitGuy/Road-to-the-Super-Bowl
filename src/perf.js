const PerfModel = (() => {
  // Independent rating from final scores only (no betting lines). Tuned on 2002-2017.
  function ratings(season, C) {
    const p = C.params, R = {};
    for (const [t, v] of Object.entries(C.prior)) R[t] = p.c * v;
    const f = season.fields, ix = Object.fromEntries(f.map((k, i) => [k, i]));
    const gs = season.games.filter(r => r[ix.homeScore] !== null && r[ix.homeScore] !== undefined)
      .slice().sort((a, b) => a[ix.week] - b[ix.week] || (a[ix.id] < b[ix.id] ? -1 : a[ix.id] > b[ix.id] ? 1 : 0));
    for (const r of gs) {
      const h = r[ix.home], a = r[ix.away], neu = !!r[ix.neutral];
      const pred = R[h] - R[a] + (neu ? 0 : p.hfa);
      const m = Math.max(-p.cap, Math.min(p.cap, r[ix.homeScore] - r[ix.awayScore]));
      const k = p.k * (r[ix.week] <= 4 ? 1.5 : 1);
      R[h] += k * (m - pred); R[a] -= k * (m - pred);
    }
    return R;
  }
  const line = (R, C, g) => R[g.home] - R[g.away] + (g.neutral ? 0 : C.params.hfa);
  return { ratings, line };
})();
if (typeof module !== 'undefined') module.exports = PerfModel;
