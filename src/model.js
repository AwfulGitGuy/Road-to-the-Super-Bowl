// NFL season model: market-implied ratings + Monte Carlo season/playoff simulation.
const NFLModel = (() => {
  const DIV = {
    'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'],
    'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'],
    'AFC South': ['HOU', 'IND', 'JAX', 'TEN'],
    'AFC West': ['DEN', 'KC', 'LV', 'LAC'],
    'NFC East': ['DAL', 'NYG', 'PHI', 'WAS'],
    'NFC North': ['CHI', 'DET', 'GB', 'MIN'],
    'NFC South': ['ATL', 'CAR', 'NO', 'TB'],
    'NFC West': ['ARI', 'LA', 'SF', 'SEA'],
  };
  const NAMES = {
    ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills', CAR: 'Panthers', CHI: 'Bears',
    CIN: 'Bengals', CLE: 'Browns', DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers',
    HOU: 'Texans', IND: 'Colts', JAX: 'Jaguars', KC: 'Chiefs', LA: 'Rams', LAC: 'Chargers',
    LV: 'Raiders', MIA: 'Dolphins', MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants',
    NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SEA: 'Seahawks', SF: '49ers', TB: 'Buccaneers',
    TEN: 'Titans', WAS: 'Commanders',
  };
  const CITY = {
    ARI: 'Arizona', ATL: 'Atlanta', BAL: 'Baltimore', BUF: 'Buffalo', CAR: 'Carolina', CHI: 'Chicago',
    CIN: 'Cincinnati', CLE: 'Cleveland', DAL: 'Dallas', DEN: 'Denver', DET: 'Detroit', GB: 'Green Bay',
    HOU: 'Houston', IND: 'Indianapolis', JAX: 'Jacksonville', KC: 'Kansas City', LA: 'Los Angeles',
    LAC: 'Los Angeles', LV: 'Las Vegas', MIA: 'Miami', MIN: 'Minnesota', NE: 'New England',
    NO: 'New Orleans', NYG: 'New York', NYJ: 'New York', PHI: 'Philadelphia', PIT: 'Pittsburgh',
    SEA: 'Seattle', SF: 'San Francisco', TB: 'Tampa Bay', TEN: 'Tennessee', WAS: 'Washington',
  };
  const TEAMS = Object.values(DIV).flat().sort();
  const IDX = Object.fromEntries(TEAMS.map((t, i) => [t, i]));
  const N = TEAMS.length;
  const divOf = new Array(N), confOf = new Array(N);
  for (const [d, ts] of Object.entries(DIV)) for (const t of ts) { divOf[IDX[t]] = d; confOf[IDX[t]] = d.slice(0, 3); }

  const SD = 11.5;            // spread-to-win-chance scale, fitted on 2002-2017 results
  const HFA_PRIOR = 1.7;       // points, prior for home-field advantage
  const DECAY0 = 0.7;          // weight per week of age for spread lines
  const PRIOR_W = 1, PRIOR_CARRY = 0.6;   // preseason prior from last season's market ratings (tuned 2006-2015)
  const LAM0 = 0.1;            // shrinkage of ratings toward average (tuned 2006-2015)
  // Quarterback value: shrunk EPA per play, in points per game (tuned on 2006-2017 lines)
  const QB = { K: 200, MU: -0.15, PLAYS: 35, C: 0.8 };
  // Chance an injured regular starter is back, by weeks past the last week with a listed starter
  // (index 0 = 1 week past). Measured on 2012-2025; checked by fitting on 2012-18 and testing on 2019-25 and vice versa.
  const RETURN = {
    ir: [0],     // injured reserve: returns are real but rare, and blending them in didn't help in testing
    head: [0.412, 0.469, 0.556, 0.6],
    other: [0.285, 0.329, 0.399, 0.442, 0.461, 0.475],
  };

  // Standard normal CDF
  function Phi(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422804014327 * Math.exp(-x * x / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
  }

  function parse(season) {
    const f = season.fields;
    const ix = Object.fromEntries(f.map((k, i) => [k, i]));
    return season.games.map(r => ({
      id: r[ix.id], week: r[ix.week], date: r[ix.date], time: r[ix.time],
      a: IDX[r[ix.away]], h: IDX[r[ix.home]],
      as: r[ix.awayScore], hs: r[ix.homeScore], spread: r[ix.spread], neutral: !!r[ix.neutral],
      final: r[ix.homeScore] !== null && r[ix.homeScore] !== undefined,
      aq: ix.awayQB !== undefined ? r[ix.awayQB] : null, hq: ix.homeQB !== undefined ? r[ix.homeQB] : null,
    }));
  }

  // Walk the season in order: each game gets its starters' values from before that week,
  // and the end state gives current values and each team's most recent starter.
  function qbState(season, games, prior) {
    const S = {};
    for (const [q, v] of Object.entries(prior || {})) S[q] = [v[0], v[1]];
    const byGame = {};
    for (const r of (season.qbGames || [])) (byGame[r[0]] = byGame[r[0]] || []).push(r);
    const val = q => { if (!q) return QB.MU; const s = S[q] || [0, 0]; return (s[0] + QB.K * QB.MU) / (s[1] + QB.K); };
    const pts = v => QB.C * QB.PLAYS * v;
    const weeks = [...new Set(games.map(g => g.week))].sort((a, b) => a - b);
    const recent = new Array(N).fill(null);
    for (const w of weeks) {
      const wg = games.filter(g => g.week === w);
      for (const g of wg) { g.qh = pts(val(g.hq)); g.qa = pts(val(g.aq)); }
      for (const g of wg) {
        if (g.hq) recent[g.h] = g.hq; if (g.aq) recent[g.a] = g.aq;
        if (g.final) for (const r of (byGame[g.id] || [])) { const s = S[r[1]] = S[r[1]] || [0, 0]; s[0] += r[3]; s[1] += r[2]; }
      }
    }
    const now = q => pts(val(q));
    return { recent, now, names: season.qbNames || {} };
  }

  // Weighted ridge least squares: spread = r_home - r_away + hfa*(!neutral)
  function fitRatings(games, o = {}) {
    const DECAY = o.decay ?? DECAY0, lam = o.lam ?? LAM0, HFA_PRIOR_W = o.hfaW ?? 4;
    const lined = games.filter(g => g.spread !== null && g.spread !== undefined);
    if (!lined.length) return { r: o.prior ? o.prior.map(v => PRIOR_CARRY * (v || 0)) : new Array(N).fill(0), hfa: HFA_PRIOR, latest: 0 };
    const latest = Math.max(...lined.map(g => g.week));
    const P = N + 1; // ratings + hfa
    const A = Array.from({ length: P }, () => new Array(P).fill(0));
    const b = new Array(P).fill(0);
    const add = (x, y, w) => {
      for (const [i, xi] of x) { b[i] += w * xi * y; for (const [j, xj] of x) A[i][j] += w * xi * xj; }
    };
    for (const g of lined) {
      const w = Math.pow(DECAY, latest - g.week);
      const x = [[g.h, 1], [g.a, -1]];
      if (!g.neutral) x.push([N, 1]);
      add(x, g.spread - (o.qb ? (g.qh - g.qa) : 0), w);
    }
    for (let i = 0; i < N; i++) A[i][i] += lam;           // shrink ratings toward 0
    if (o.prior) for (let i = 0; i < N; i++) { A[i][i] += PRIOR_W; b[i] += PRIOR_W * PRIOR_CARRY * (o.prior[i] || 0); } // last season, pulled toward average
    A[N][N] += HFA_PRIOR_W; b[N] += HFA_PRIOR_W * HFA_PRIOR;                    // hfa prior
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) A[i][j] += 1; // sum-to-zero soft constraint
    const sol = solve(A, b);
    return { r: sol.slice(0, N), hfa: sol[N], latest };
  }

  function solve(A, b) {
    const n = b.length, M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) {
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  // sfc32 (a well-tested small generator), seeded through splitmix32. It replaced mulberry32, whose
  // single long streams showed slightly correlated draws past ~50,000 simulated seasons.
  function rng(seed) {
    let x = seed >>> 0;
    const mix = () => { x = (x + 0x9E3779B9) >>> 0; let z = x; z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B); z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35); return (z ^ (z >>> 16)) >>> 0; };
    let a = mix(), b = mix(), c = mix(), d = mix();
    const next = () => {
      const t = (((a + b) >>> 0) + d) >>> 0; d = (d + 1) >>> 0;
      a = b ^ (b >>> 9); b = (c + (c << 3)) >>> 0; c = ((c << 21) | (c >>> 11)); c = (c + t) >>> 0;
      return t / 4294967296;
    };
    for (let i = 0; i < 12; i++) next();
    return next;
  }
  function gauss(rand) { let u = 0, v = 0; while (u === 0) u = rand(); v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // ---------- Tiebreakers ----------
  // res: array of {a,h,w} where w = index of winner, or -1 for tie. rec per team built per sim.
  function makeStandings(results) {
    const W = new Float64Array(N), L = new Float64Array(N), T = new Float64Array(N);
    const opp = Array.from({ length: N }, () => []);   // list of [opp, score 1/0.5/0]
    for (const g of results) {
      if (g.w === -1) { T[g.a]++; T[g.h]++; opp[g.a].push([g.h, 0.5]); opp[g.h].push([g.a, 0.5]); }
      else { const l = g.w === g.a ? g.h : g.a; W[g.w]++; L[l]++; opp[g.w].push([l, 1]); opp[l].push([g.w, 0]); }
    }
    const pct = new Float64Array(N);
    for (let i = 0; i < N; i++) { const gp = W[i] + L[i] + T[i]; pct[i] = gp ? (W[i] + T[i] / 2) / gp : 0; }
    return { W, L, T, pct, opp };
  }
  function recVs(st, t, filter) {
    let s = 0, n = 0;
    for (const [o, v] of st.opp[t]) if (filter(o)) { s += v; n++; }
    return n ? s / n : null;
  }
  function sov(st, t) { let w = 0, g = 0; for (const [o, v] of st.opp[t]) if (v === 1) { w += st.W[o] + st.T[o] / 2; g += st.W[o] + st.L[o] + st.T[o]; } return g ? w / g : 0; }
  function sos(st, t) { let w = 0, g = 0; for (const [o] of st.opp[t]) { w += st.W[o] + st.T[o] / 2; g += st.W[o] + st.L[o] + st.T[o]; } return g ? w / g : 0; }

  // Pick the single best team from tied set using criteria list; returns team.
  function pickBest(st, tied, criteria, rand) {
    let set = tied.slice();
    for (const crit of criteria) {
      if (set.length === 1) break;
      const vals = crit(st, set);
      if (!vals) continue;
      const best = Math.max(...vals.map(v => (v === null ? -1 : v)));
      const keep = set.filter((t, i) => vals[i] !== null && Math.abs(vals[i] - best) < 1e-9);
      if (keep.length && keep.length < set.length) {
        // When a multi-team tie is reduced to 2+ teams, restart the procedure (NFL rule)
        if (keep.length >= 2 && keep.length < tied.length) return pickBest(st, keep, criteria, rand);
        set = keep;
      }
    }
    return set[Math.floor(rand() * set.length)];
  }
  const h2h = (st, set) => set.map(t => recVs(st, t, o => set.includes(o) && o !== t));
  const h2hSweep = (st, set) => {
    if (set.length === 2) return h2h(st, set);
    // 3+ teams: applies only if one team beat all others or lost to all others
    const played = set.map(t => set.every(o => o === t || st.opp[t].some(([x]) => x === o)));
    if (!played.every(Boolean)) return null;
    return h2h(st, set).map(v => (v === 1 ? 1 : v === 0 ? 0 : 0.5));
  };
  const divRec = (st, set) => set.map(t => recVs(st, t, o => divOf[o] === divOf[t]));
  const confRec = (st, set) => set.map(t => recVs(st, t, o => confOf[o] === confOf[t]));
  const common = minGames => (st, set) => {
    const oppSets = set.map(t => new Set(st.opp[t].map(([o]) => o)));
    const com = [...oppSets[0]].filter(o => oppSets.every(s => s.has(o)) && !set.includes(o));
    const vals = set.map(t => { let s = 0, n = 0; for (const [o, v] of st.opp[t]) if (com.includes(o)) { s += v; n++; } return n >= minGames ? s / n : null; });
    return vals.every(v => v !== null) ? vals : null;
  };
  const sovC = (st, set) => set.map(t => sov(st, t));
  const sosC = (st, set) => set.map(t => sos(st, t));
  const DIV_CRIT = [h2h, divRec, common(1), confRec, sovC, sosC];
  const WC_CRIT = [h2hSweep, confRec, common(4), sovC, sosC];

  // Order a set of teams: repeatedly pick best among those with best pct.
  function orderTeams(st, teams, crit, rand) {
    const out = [], left = teams.slice();
    while (left.length) {
      const bestPct = Math.max(...left.map(t => st.pct[t]));
      const tied = left.filter(t => Math.abs(st.pct[t] - bestPct) < 1e-9);
      const pick = tied.length === 1 ? tied[0] : pickBest(st, tied, crit, rand);
      out.push(pick); left.splice(left.indexOf(pick), 1);
    }
    return out;
  }

  function seedConference(st, conf, rand) {
    const divs = Object.keys(DIV).filter(d => d.startsWith(conf));
    const divOrder = divs.map(d => orderTeams(st, DIV[d].map(t => IDX[t]), DIV_CRIT, rand));
    const winners = divOrder.map(o => o[0]);
    const seedsTop = orderTeams(st, winners, WC_CRIT, rand);
    // Wild card: only the highest-ranked remaining team of each division enters each comparison
    const pools = divOrder.map(o => o.slice(1));
    const wc = [];
    while (wc.length < 3) {
      const cands = pools.filter(p => p.length).map(p => p[0]);
      const pick = orderTeams(st, cands, WC_CRIT, rand)[0];
      wc.push(pick);
      for (const p of pools) if (p[0] === pick) p.shift();
    }
    return { seeds: [...seedsTop, ...wc], divWinners: winners };
  }

  // ---------- Simulation ----------
  function simulate(season, opts = {}) {
    const sims = opts.sims || 10000;
    const picks = opts.picks || {};   // gameId -> team abbr forced winner
    // Each simulated season gets its own random streams (games, tiebreak coin flips, playoffs), so a change in one
    // season or one game never shifts the random draws of any other. That keeps paired comparisons exact.
    const seed0 = (opts.seed || 20260928) >>> 0;
    let rand = rng(seed0), rT = rand, rP = rand;
    const games = parse(season);
    const useQB = opts.qb !== false && Array.isArray(season.qbGames);
    const qs = useQB ? qbState(season, games, opts.qbPrior) : null;
    const marketPrior = opts.marketPrior ? TEAMS.map(t => opts.marketPrior[t] || 0) : null;
    const fit = fitRatings(games, { ...(opts.fit || {}), qb: useQB, prior: marketPrior });
    const qbPicks = opts.qbPicks || {};                          // team abbr -> player id chosen by the viewer
    const starter = t => (qbPicks[TEAMS[t]] || qs.recent[t]);
    const qbv = t => (useQB ? qs.now(starter(t)) : 0);            // current starter's value, points
    // Injured regular starters (season.qbOut): past the weeks with a listed starter, blend in his chance of being back.
    const curves = opts.returnCurves || RETURN;
    const retP = (cls, k) => { const c = curves[cls] || curves.other; return c[Math.min(c.length, Math.max(1, k)) - 1]; };
    const out = {};                                               // team index -> { qb, cls, listed }
    if (useQB && opts.qbReturn !== false && season.qbOut && typeof season.qbOut === 'object') {
      for (const [ab, o] of Object.entries(season.qbOut)) {
        const t = IDX[ab];
        if (t === undefined || !o || !o.qb || qbPicks[ab] || o.qb === qs.recent[t]) continue;
        let listed = 0;
        for (const g of games) if ((g.h === t && g.hq) || (g.a === t && g.aq)) listed = Math.max(listed, g.week);
        out[t] = { qb: o.qb, cls: o.cls, listed };
      }
    }
    const val = (t, q, wk) => {                                   // expected QB value for team t in week wk
      const o = out[t];
      if (!o || q !== qs.recent[t] || wk <= o.listed) return qs.now(q);
      const p = retP(o.cls, wk - o.listed);
      return (1 - p) * qs.now(q) + p * qs.now(o.qb);
    };
    for (const g of games) if (!g.final) {
      g.sh = useQB ? (qbPicks[TEAMS[g.h]] || g.hq || qs.recent[g.h]) : null; g.sa = useQB ? (qbPicks[TEAMS[g.a]] || g.aq || qs.recent[g.a]) : null;
      g.qadj = useQB ? val(g.h, g.sh, g.week) - val(g.a, g.sa, g.week) : 0;
    }
    const done = games.filter(g => g.final);
    const lastPlayedWeek = done.length ? Math.max(...done.map(g => g.week)) : 0;
    const left = games.filter(g => !g.final);
    const lastWeek = Math.max(18, ...games.map(g => g.week));
    const weeksLeft = Math.max(0, lastWeek - lastPlayedWeek);
    const sd = opts.sd || SD;
    const legacy = !!opts.legacy;
    // Rating drift: a random walk that starts after the latest posted lines (measured from 2006-2025 lines)
    const dm = opts.drift || 2, D0 = 2.1 * dm * dm, DW = 0.72 * dm * dm;
    const shockSD = legacy ? Math.sqrt(1.5 * 1.5 + 2.5 * 2.5 * weeksLeft / 18) : Math.sqrt(D0 + DW * weeksLeft);

    const fixed = done.map(g => ({ a: g.a, h: g.h, w: g.hs > g.as ? g.h : g.as > g.hs ? g.a : -1 }));
    // "Who to root for": for chosen games, count how often the tracked team reaches each goal after each result.
    const trk = opts.track && IDX[opts.track.team] !== undefined ? opts.track : null;
    const tT = trk ? IDX[trk.team] : -1, tIdx = new Map(), tHome = [];
    if (trk) (trk.games || []).forEach(id => { const g = left.find(x => x.id === id); if (g && picks[id] === undefined) { tIdx.set(id, tHome.length); tHome.push(g); } });
    const tk = tHome.length, tW = new Uint8Array(tk), T = { hw: new Float64Array(tk), goal: ['playoff', 'div', 'bye'].map(() => ({ h: new Float64Array(tk), a: new Float64Array(tk) })) };

    const gpt = new Array(N).fill(0); for (const g of games) { gpt[g.h]++; gpt[g.a]++; }
    const maxG = Math.max(17, ...gpt);
    const acc = {
      wins: new Float64Array(N), playoff: new Float64Array(N), div: new Float64Array(N),
      bye: new Float64Array(N), conf: new Float64Array(N), sb: new Float64Array(N), sbApp: new Float64Array(N),
      seed: Array.from({ length: N }, () => new Float64Array(8)),
      winDist: Array.from({ length: N }, () => new Float64Array(maxG + 1)),
    };
    const gameWin = new Map(); // gameId -> home win count

    const mp = (sp, dr) => Phi((sp + dr) / sd);
    // Finished playoff games: team pair -> real winner (a pair meets at most once in a postseason)
    const poWin = new Map();
    if (Array.isArray(season.playoffs) && season.playoffFields) {
      const pix = Object.fromEntries(season.playoffFields.map((k, i) => [k, i]));
      for (const r of season.playoffs) {
        const as = r[pix.awayScore], hs = r[pix.homeScore];
        if (as === null || hs === null || as === undefined || as === hs) continue;
        const a = IDX[r[pix.away]], h = IDX[r[pix.home]];
        if (a === undefined || h === undefined) continue;
        poWin.set(Math.min(a, h) * 64 + Math.max(a, h), hs > as ? h : a);
      }
    }
    const qbvPO = t => (useQB && !qbPicks[TEAMS[t]] ? val(t, starter(t), lastWeek + 2) : qbv(t));   // playoffs: end-of-season value
    const L = fit.latest;                 // latest week with posted lines
    const walkWeeks = Math.max(1, lastWeek + 1 - L);
    const walk = Array.from({ length: N }, () => new Float64Array(walkWeeks + 1));

    let tMade = [false, false, false];
    for (let s = 0; s < sims; s++) {
      rand = rng((seed0 ^ Math.imul(s + 1, 0x9E3779B1)) >>> 0);
      rT = rng(((seed0 + 0x7F4A7C15) ^ Math.imul(s + 1, 0x85EBCA6B)) >>> 0);
      rP = rng(((seed0 + 0x2545F491) ^ Math.imul(s + 1, 0xC2B2AE35)) >>> 0);
      const shock = new Float64Array(N);
      if (legacy) for (let i = 0; i < N; i++) shock[i] = gauss(rand) * shockSD;
      else {
        for (let i = 0; i < N; i++) {
          let v = gauss(rand) * Math.sqrt(D0);
          walk[i][0] = v;
          for (let k = 1; k <= walkWeeks; k++) { v += gauss(rand) * Math.sqrt(DW); walk[i][k] = v; }
          shock[i] = v;                   // end-of-season strength, used in the playoffs
        }
      }
      const off = (t, wk) => legacy ? shock[t] : walk[t][Math.min(walkWeeks, Math.max(0, wk - L - 1))];
      const res = fixed.slice();
      for (const g of left) {
        let w;
        const forced = picks[g.id];
        if (forced !== undefined) { w = IDX[forced]; rand(); }   // draw anyway, so a pick changes only this game (paired comparisons)
        else {
          const lined = g.spread !== null && g.spread !== undefined;
          const base = lined ? g.spread : fit.r[g.h] - fit.r[g.a] + (g.neutral ? 0 : fit.hfa) + g.qadj;
          const p = (lined && !legacy) ? mp(base, 0) : mp(base, off(g.h, g.week) - off(g.a, g.week));
          w = rand() < p ? g.h : g.a;
        }
        res.push({ a: g.a, h: g.h, w });
        if (tk) { const k = tIdx.get(g.id); if (k !== undefined) tW[k] = w === g.h ? 1 : 0; }
        if (w === g.h) gameWin.set(g.id, (gameWin.get(g.id) || 0) + 1);
      }
      const st = makeStandings(res);
      for (let i = 0; i < N; i++) { acc.wins[i] += st.W[i]; acc.winDist[i][Math.min(maxG, Math.round(st.W[i]))]++; }
      const champs = {};
      for (const conf of ['AFC', 'NFC']) {
        const { seeds, divWinners } = seedConference(st, conf, rT);
        if (tk && confOf[tT] === conf) { tMade = [seeds.includes(tT), divWinners.includes(tT), seeds[0] === tT]; }
        seeds.forEach((t, k) => { acc.playoff[t]++; acc.seed[t][k + 1]++; });
        divWinners.forEach(t => acc.div[t]++);
        acc.bye[seeds[0]]++;
        // playoffs
        const str = t => fit.r[t] + shock[t] + qbvPO(t);
        const play = (hi, lo, neutral) => {
          const real = poWin.get(Math.min(hi, lo) * 64 + Math.max(hi, lo));   // already played for real
          if (real !== undefined) return real;
          const p = Phi((str(hi) - str(lo) + (neutral ? 0 : fit.hfa)) / sd);
          return rP() < p ? hi : lo;
        };
        const seedOf = t => seeds.indexOf(t);
        let alive = [seeds[0], play(seeds[1], seeds[6]), play(seeds[2], seeds[5]), play(seeds[3], seeds[4])];
        alive.sort((x, y) => seedOf(x) - seedOf(y));
        const d1 = play(alive[0], alive[3]), d2 = play(alive[1], alive[2]);
        const [hi, lo] = seedOf(d1) < seedOf(d2) ? [d1, d2] : [d2, d1];
        const champ = play(hi, lo);
        acc.conf[champ]++; acc.sbApp[champ]++;
        champs[conf] = champ;
      }
      const hosts = opts.sbHosts || [];                                   // teams whose home stadium hosts the Super Bowl
      const sofi = (hosts.includes(TEAMS[champs.AFC]) ? fit.hfa / 2 : 0) - (hosts.includes(TEAMS[champs.NFC]) ? fit.hfa / 2 : 0);
      const realSB = poWin.get(Math.min(champs.AFC, champs.NFC) * 64 + Math.max(champs.AFC, champs.NFC));
      const winner = realSB !== undefined ? realSB : Phi((fit.r[champs.AFC] + shock[champs.AFC] + qbvPO(champs.AFC) - fit.r[champs.NFC] - shock[champs.NFC] - qbvPO(champs.NFC) + sofi) / sd) > rP() ? champs.AFC : champs.NFC;
      acc.sb[winner]++;
      if (tk) for (let k = 0; k < tk; k++) { const hw = tW[k]; T.hw[k] += hw; for (let q = 0; q < 3; q++) if (tMade[q]) T.goal[q][hw ? 'h' : 'a'][k]++; }
    }

    const st = makeStandings(fixed);
    const teams = TEAMS.map((t, i) => ({
      abbr: t, name: NAMES[t], city: CITY[t], div: divOf[i], conf: confOf[i],
      w: st.W[i], l: st.L[i], t: st.T[i], rating: fit.r[i] + qbv(i), baseRating: fit.r[i],
      qbName: useQB && starter(i) ? (qs.names[starter(i)] || null) : null, qbPts: useQB && starter(i) ? qbv(i) : null, qbId: useQB ? starter(i) : null,
      qbOptions: useQB ? qbOptions(i) : [],
      qbOut: out[i] ? { id: out[i].qb, name: qs.names[out[i].qb] || null, cls: out[i].cls, listed: out[i].listed, pNext: retP(out[i].cls, 1), pEnd: retP(out[i].cls, lastWeek + 2 - out[i].listed) } : null,
      projW: acc.wins[i] / sims, playoff: acc.playoff[i] / sims, divWin: acc.div[i] / sims,
      bye: acc.bye[i] / sims, confWin: acc.conf[i] / sims, sbWin: acc.sb[i] / sims,
      seed: Array.from(acc.seed[i]).map(x => x / sims), winDist: Array.from(acc.winDist[i]).map(x => x / sims),
    }));
    const upcoming = left.map(g => ({
      id: g.id, week: g.week, date: g.date, time: g.time, away: TEAMS[g.a], home: TEAMS[g.h], neutral: g.neutral,
      spread: g.spread, modelSpread: fit.r[g.h] - fit.r[g.a] + (g.neutral ? 0 : fit.hfa) + g.qadj,
      awayQB: g.sa ? (qs.names[g.sa] || null) : null, homeQB: g.sh ? (qs.names[g.sh] || null) : null,
      pHome: (gameWin.get(g.id) || 0) / sims,
    }));
    function qbOptions(t) {
      const seen = new Map();
      for (const g of games) { if (g.h === t && g.hq) seen.set(g.hq, g.week); if (g.a === t && g.aq) seen.set(g.aq, g.week); }
      return [...seen.keys()].map(id => ({ id, name: qs.names[id] || id, pts: qs.now(id), recent: id === qs.recent[t] }));
    }
    const results = done.map(g => ({ id: g.id, week: g.week, date: g.date, away: TEAMS[g.a], home: TEAMS[g.h], as: g.as, hs: g.hs }));
    const track = tk ? tHome.map((g, k) => {
      const nh = T.hw[k], na = sims - nh, f = (x, n) => (n ? x / n : null);
      return { id: g.id, week: g.week, date: g.date, time: g.time, away: TEAMS[g.a], home: TEAMS[g.h], neutral: g.neutral, pHome: nh / sims,
        ifHome: T.goal.map(q => f(q.h[k], nh)), ifAway: T.goal.map(q => f(q.a[k], na)) };
    }) : null;
    return { teams, upcoming, results, maxGames: maxG, hfa: fit.hfa, ratingWeek: fit.latest, lastPlayedWeek, sims, shockSD, track, sd };
  }

  // Seed a finished season from its results (for checking tiebreakers against real brackets)
  function seedSeason(season, seed = 1) {
    const games = parse(season).filter(g => g.final);
    const st = makeStandings(games.map(g => ({ a: g.a, h: g.h, w: g.hs > g.as ? g.h : g.as > g.hs ? g.a : -1, hs: g.hs, as: g.as })));
    const rand = rng(seed);
    const out = {};
    for (const conf of ['AFC', 'NFC']) out[conf] = seedConference(st, conf, rand).seeds.map(t => TEAMS[t]);
    return out;
  }
  // The season as it stood after week `cut`: results through cut, lines and projected starters through cut+1.
  function truncate(season, cut) {
    const ix = Object.fromEntries(season.fields.map((k, i) => [k, i]));
    const games = season.games.map(r => {
      const x = r.slice(), wk = r[ix.week];
      if (wk > cut) { x[ix.awayScore] = null; x[ix.homeScore] = null; }
      if (wk > cut + 1) { x[ix.spread] = null; if (ix.awayQB !== undefined) { x[ix.awayQB] = null; x[ix.homeQB] = null; } }
      return x;
    });
    const fin = new Set(games.filter(r => r[ix.homeScore] !== null && r[ix.homeScore] !== undefined).map(r => r[ix.id]));
    const played = season.games.filter(r => r[ix.homeScore] !== null && r[ix.homeScore] !== undefined).map(r => r[ix.week]);
    const out = { ...season, games, qbGames: (season.qbGames || []).filter(r => fin.has(r[0])) };
    if (cut < Math.max(0, ...played)) delete out.qbOut;          // today's injury report wasn't known in earlier weeks
    return out;
  }
  // Odds after each completed week (0 = before Week 1), for every team.
  function history(season, opts = {}) {
    const ix = Object.fromEntries(season.fields.map((k, i) => [k, i]));
    const played = season.games.filter(r => r[ix.homeScore] !== null && r[ix.homeScore] !== undefined).map(r => r[ix.week]);
    const last = played.length ? Math.max(...played) : 0;
    const out = [];
    for (let cut = 0; cut <= last; cut++) {
      const r = simulate(truncate(season, cut), { ...opts, picks: {}, qbPicks: {}, sims: opts.sims || 2000, seed: 1000 + cut });
      out.push({ week: cut, teams: Object.fromEntries(r.teams.map(t => [t.abbr, [t.playoff, t.divWin, t.sbWin]])) });
    }
    return out;
  }
  return { simulate, fitRatings, parse, seedSeason, truncate, history, TEAMS, IDX, DIV, NAMES, CITY, Phi };
})();
if (typeof module !== 'undefined') module.exports = NFLModel;
