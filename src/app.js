(() => {
const M = NFLModel;
const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

let CFG = DEFAULT_CONFIG;             // current-season settings (from the database when available)
let YEAR = CFG.current;               // season being viewed
let PRI = DEFAULT_PRIORS;             // that season's starting values
let season = SNAPSHOT;
let HIST = null, histToken = '';
const pkey = k => `nfl.${k}.${YEAR}`;
let picks = store.get(pkey('picks'), {});
let qbPicks = store.get(pkey('qbpicks'), {});
let focus = '';   // set below from the link (#BUF) or this browser's last choice
let conf = store.get('nfl26.conf', null);
let sortKey = null, sortDir = -1;
let week = null;
let base = null, cur = null, swing = null;
let jobSeq = 0;
let PR = null;

// ---- worker (falls back to the main thread) ----
let worker = null;
try {
  const src = document.getElementById('model-src').textContent +
    '\nself.onmessage=e=>{const {id,kind,season,opts}=e.data;const res=kind==="hist"?NFLModel.history(season,opts):NFLModel.simulate(season,opts);self.postMessage({id,res});};';
  worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
} catch (e) { worker = null; }
const pending = new Map();
if (worker) worker.onmessage = e => { const f = pending.get(e.data.id); pending.delete(e.data.id); f && f(e.data.res); };
// Super Bowl host team(s): from the data once the game is listed, otherwise from the season's setup.
const sbHosts = () => (season.sbSite && Array.isArray(season.sbSite.hosts) ? season.sbSite.hosts : (PRI.sb || CFG.sb || {}).hosts) || [];
function job(kind, opts) {
  return new Promise(resolve => {
    opts = { qbPrior: PRI.qb, marketPrior: PRI.market, sbHosts: sbHosts(), ...opts };
    if (worker) { const id = ++jobSeq; pending.set(id, resolve); worker.postMessage({ id, kind, season, opts }); }
    else setTimeout(() => resolve(kind === 'hist' ? M.history(season, opts) : M.simulate(season, opts)), 0);
  });
}
const sim = opts => job('sim', opts);
const isFinal = () => !base || base.upcoming.length === 0;

// ---- formatting ----
const pct = (p, fine) => {
  if (p === 0) return '—';
  if (p >= 1) return '100%';
  if (p < 0.001) return '<0.1%';
  if (p > 0.999) return '>99.9%';
  if (!fine && p < 0.01) return '<1%';
  if (!fine && p > 0.99) return '>99%';
  return (p * 100).toFixed(fine && p < 0.1 ? 1 : 0) + '%';
};
const rec = t => `${t.w}–${t.l}${t.t ? '–' + t.t : ''}`;
const sign = x => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(1);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Schedule times are Eastern. Convert to the visitor's own time zone.
function kickoff(g) {
  if (!g.date) return null;
  const [y, m, d] = g.date.split('-').map(Number);
  if (!g.time) return { y, m, d, dt: null };
  const [h, mi] = g.time.split(':').map(Number);
  const nth = (mon, dow, n) => { const f = new Date(Date.UTC(y, mon, 1)).getUTCDay(); return 1 + ((dow - f + 7) % 7) + 7 * (n - 1); };
  const t = Date.UTC(y, m - 1, d), dstOn = Date.UTC(y, 2, nth(2, 0, 2)), dstOff = Date.UTC(y, 10, nth(10, 0, 1));
  const off = t >= dstOn && t < dstOff ? 4 : 5;                     // US Eastern daylight time: 2nd Sunday of March to 1st Sunday of November
  return { y, m, d, dt: new Date(Date.UTC(y, m - 1, d, h + off, mi)) };
}
function when(g) {
  const k = kickoff(g); if (!k) return '';
  if (!k.dt) { const dt = new Date(Date.UTC(k.y, k.m - 1, k.d)); return `${DOW[dt.getUTCDay()]} ${MON[k.m - 1]} ${k.d} · time TBD`; }
  try {
    const day = k.dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const tm = k.dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    return `${day} · ${tm}`;
  } catch (e) { return k.dt.toString(); }
}
// Which national window a game is in, and where it usually airs. Special games say "check listings".
const LISTINGS = 'https://www.nfl.com/schedules/';
function tvInfo(g) {
  if (!g.date || !g.time) return null;
  const [y, m, d] = g.date.split('-').map(Number), [h] = g.time.split(':').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const nov1 = new Date(Date.UTC(y, 10, 1)).getUTCDay(), tg = 1 + ((4 - nov1 + 7) % 7) + 21;   // Thanksgiving: 4th Thursday of November
  const check = label => ({ label, where: null });
  const first = season.games.reduce((a, r) => (!a || r[2] + (r[3] || '') < a ? r[2] + (r[3] || '') : a), '');
  if (g.date + (g.time || '') === first) return { label: 'NFL Kickoff game', where: 'NBC, Peacock' };
  if (g.neutral) return check('International game');
  if (m === 12 && d === 25) return check('Christmas game');
  if (m === 11 && d === tg) return check('Thanksgiving');
  if (m === 11 && (d === tg - 1 || d === tg + 1)) return check(d < tg ? 'Thanksgiving Eve' : 'Black Friday');
  if (dow === 4 && h >= 19) return { label: 'Thursday Night Football', where: 'Prime Video' };
  if (dow === 0 && h >= 19) return { label: 'Sunday Night Football', where: 'NBC, Peacock' };
  if (dow === 1 && h >= 19) return { label: 'Monday Night Football', where: 'ESPN or ABC' };
  if (dow === 0 && h >= 12) return { label: 'Sunday afternoon', where: 'CBS or FOX (varies by area)' };
  return check(dow === 6 ? 'Saturday game' : 'Special game');
}
const tvText = g => { const t = tvInfo(g); if (!t) return ''; return t.where ? `${t.label}: ${t.where}` : `${t.label}: <a href="${LISTINGS}" target="_blank" rel="noopener">check listings</a>`; };
const CITY_OF = { 'Melbourne Cricket Ground': 'Melbourne', 'Maracana Stadium': 'Rio de Janeiro', 'Tottenham Hotspur Stadium': 'London', 'Wembley Stadium': 'London',
  'Stade de France': 'Paris', 'Bernabeu': 'Madrid', 'FC Bayern Munich Stadium': 'Munich', 'Allianz Arena': 'Munich', 'Estadio Banorte': 'Mexico City', 'Estadio Azteca': 'Mexico City',
  'Deutsche Bank Park': 'Frankfurt', 'Olympiastadion': 'Berlin', 'Croke Park': 'Dublin', 'Neo Quimica Arena': 'Sao Paulo', 'Arena Corinthians': 'Sao Paulo' };
const venue = g => g.stadium ? esc(g.stadium) + (CITY_OF[g.stadium] ? ', ' + CITY_OF[g.stadium] : '') : '';

function line(g) {
  if (g.spread === null || g.spread === undefined) return null;
  if (g.spread === 0) return 'Pick’em';
  return g.spread > 0 ? `${g.home} −${g.spread}` : `${g.away} −${-g.spread}`;
}
const team = (r, ab) => r.teams.find(t => t.abbr === ab);
// team colors (primary, secondary) for the small identifying dots
const TC = { ARI: ['#97233F', '#FFB612'], ATL: ['#A71930', '#000000'], BAL: ['#241773', '#9E7C0C'], BUF: ['#00338D', '#C60C30'], CAR: ['#0085CA', '#101820'], CHI: ['#0B162A', '#C83803'], CIN: ['#FB4F14', '#000000'], CLE: ['#311D00', '#FF3C00'],
  DAL: ['#003594', '#869397'], DEN: ['#FB4F14', '#002244'], DET: ['#0076B6', '#B0B7BC'], GB: ['#203731', '#FFB612'], HOU: ['#03202F', '#A71930'], IND: ['#002C5F', '#A2AAAD'], JAX: ['#006778', '#D7A22A'], KC: ['#E31837', '#FFB81C'],
  LV: ['#000000', '#A5ACAF'], LAC: ['#0080C6', '#FFC20E'], LA: ['#003594', '#FFA300'], MIA: ['#008E97', '#FC4C02'], MIN: ['#4F2683', '#FFC62F'], NE: ['#002244', '#C60C30'], NO: ['#D3BC8D', '#101820'], NYG: ['#0B2265', '#A71930'],
  NYJ: ['#125740', '#FFFFFF'], PHI: ['#004C54', '#A5ACAF'], PIT: ['#FFB612', '#101820'], SF: ['#AA0000', '#B3995D'], SEA: ['#002244', '#69BE28'], TB: ['#D50A0A', '#34302B'], TEN: ['#0C2340', '#4B92DB'], WAS: ['#5A1414', '#FFB612'] };
const chip = t => TC[t] ? `<i class="chip" style="--c1:${TC[t][0]};--c2:${TC[t][1]}" aria-hidden="true"></i>` : '';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- run ----
let runId = 0;
async function runAll(reason) {
  const my = ++runId;                       // a newer run (e.g. another season) makes this one stale
  $('#runstatus').textContent = reason || 'Simulating 10,000 seasons…';
  const nPicks = Object.keys(picks).length + Object.keys(qbPicks).length;
  const b = base || await sim({ sims: 10000 });
  if (my !== runId) return;
  base = b;
  const c = nPicks ? await sim({ sims: 10000, picks, qbPicks }) : b;
  if (my !== runId) return;
  cur = c;
  PR = PerfModel.ratings(season, { params: PERF_CONST.params, prior: PRI.perf || PERF_CONST.prior });
  for (const r of [base, cur]) r.teams.forEach(t => { t.perf = PR[t.abbr]; });
  $('#runstatus').textContent = nPicks ? `10,000 seasons · ${nPicks} what-if choice${nPicks > 1 ? 's' : ''} applied` : '10,000 simulated seasons';
  renderAll();
  runSwing();
  runHistory();
}
async function runHistory() {
  const token = YEAR + '|' + season.updatedAt;
  if (HIST && histToken === token) { renderHistory(); return; }
  histToken = token; HIST = null; renderHistory();
  const h = await job('hist', { sims: 2000 });
  if (token !== histToken) return;
  HIST = h; renderHistory(); renderOverview();
}
async function runSwing() {
  const my = runId;
  if (!focus || !cur) return;
  const g = cur.upcoming.find(x => (x.home === focus || x.away === focus) && !(x.id in picks));
  swing = null;
  if (!g) { renderNext(); return; }
  const token = focus + g.id + JSON.stringify(picks) + JSON.stringify(qbPicks);
  const [w, l] = await Promise.all([
    sim({ sims: 6000, qbPicks, picks: { ...picks, [g.id]: focus } }),
    sim({ sims: 6000, qbPicks, picks: { ...picks, [g.id]: g.home === focus ? g.away : g.home } }),
  ]);
  if (my !== runId || token !== focus + g.id + JSON.stringify(picks) + JSON.stringify(qbPicks)) return;
  swing = { id: g.id, win: team(w, focus).playoff, lose: team(l, focus).playoff };
  renderNext();
}

// ---- render ----
function renderAll() {
  const r = cur;
  const upd = updStr();
  const sbName = (PRI.sb || CFG.sb || {}).name || 'the Super Bowl';
  $('#eyebrow').textContent = `${YEAR} NFL season simulator`;
  $('#sbtitle').textContent = `Road to ${sbName}`;
  const sbDone = poGames().some(g => g.round === 4 && poWinner(g));
  $('#asof').textContent = sbDone ? `${YEAR} season · final` : (isFinal() ? 'Regular season complete' : `Through Week ${r.lastPlayedWeek}`) + (upd ? ` · updated ${upd}` : '');
  document.querySelectorAll('.sbname').forEach(el => { el.textContent = sbName; });
  $('#foot-upd').textContent = upd ? ` Data last updated ${upd}.` : '';
  { const sb = PRI.sb || CFG.sb || {}, site = season.sbSite || null, venueName = (site && site.stadium) || sb.venue || '', hs = sbHosts();
    const who = hs.map(t => 'the ' + M.NAMES[t]).join(' or ');
    const past = poGames().some(g => g.round === 4 && poWinner(g));
    $('#sbsite').textContent = !venueName ? '' : past
      ? `${sb.name || 'The Super Bowl'} was played at ${venueName}${hs.length ? `, home of ${who}.` : ', a neutral site.'}`
      : `${sb.name || 'The Super Bowl'} is at ${venueName}${hs.length ? `, so ${who} would get half the usual home-field edge if they reach it.` : ', a neutral site for every team.'}`; }
  $('#hfa').textContent = r.hfa.toFixed(1);
  $('#shock').textContent = '±' + r.shockSD.toFixed(0);
  renderOverview(); renderFocus(); renderTable(); renderWhatIf(); renderVs(); renderBracket(); renderProjected();
  loadRooting(); renderRoot();
  updateNav();
}
// "today 8:19 AM EDT" or "Mon, Sep 28, 6:07 PM EDT", in the visitor's own time zone
function updStr() {
  const d = new Date(season.updatedAt || '');
  if (isNaN(d)) return '';
  const today = d.toDateString() === new Date().toDateString();
  const o = today ? { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' } : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  try { return (today ? 'today ' : '') + d.toLocaleString(undefined, o); } catch (e) { return d.toLocaleString(); }
}
const poss = n => n + (n.endsWith('s') ? '’' : '’s');

function renderFocus() {
  renderPicker();
  const nm = focus ? M.NAMES[focus] : 'Your team';
  $('#focus-name').textContent = nm; $('#focus-name-2').textContent = focus ? 'the ' + nm : 'your team'; $('#focus-name-3').textContent = focus ? 'the ' + poss(nm) : 'your team’s';
  if (!focus) return;
  const t = team(cur, focus), b0 = team(base, focus);
  const hasPicks = Object.keys(picks).length + Object.keys(qbPicks).length > 0;
  const d = (a, z) => {
    if (!hasPicks) return '';
    const x = (a - z) * 100; if (Math.abs(x) < 0.5) return '';
    return ` <span class="delta ${x > 0 ? 'up' : 'down'}">${x > 0 ? '▲' : '▼'} ${Math.abs(x).toFixed(0)} pts</span>`;
  };
  const pf = (v, fine) => (isFinal() && v === 0 ? '0%' : pct(v, fine));
  const wl = `${t.projW.toFixed(1)}–${(17 - t.projW).toFixed(1)}`;
  $('#stats').innerHTML = `
    <div class="stat wide"><div class="v big num">${pf(t.playoff)}</div><div class="k">Chance to make the playoffs${d(t.playoff, b0.playoff)}</div></div>
    <div class="stat"><div class="v num">${pf(t.divWin)}</div><div class="k">Win the ${esc(t.div)}${d(t.divWin, b0.divWin)}</div></div>
    <div class="stat"><div class="v num">${pf(t.bye)}</div><div class="k">Earn the #1 seed and bye${d(t.bye, b0.bye)}</div></div>
    <div class="stat"><div class="v num">${pf(t.confWin, true)}</div><div class="k">Win the ${t.conf}${d(t.confWin, b0.confWin)}</div></div>
    <div class="stat"><div class="v num">${pf(t.sbWin, true)}</div><div class="k">Win <span class="sbname">${esc((PRI.sb || CFG.sb || {}).name || 'the Super Bowl')}</span>${d(t.sbWin, b0.sbWin)}</div></div>
    <div class="stat"><div class="v num">${rec(t)}</div><div class="k">Record now</div></div>
    <div class="stat"><div class="v num">${wl}</div><div class="k">Projected final record</div></div>
    <div class="stat wide"><div class="k">Team rating <b class="num">${sign(t.rating)}</b> points vs. an average team (${ratingRank(t)} of 32)</div></div>
    ${t.qbOptions && t.qbOptions.length ? `<div class="stat wide qbpick"><label class="k" for="qbsel">Starting QB for future games</label>
      <select id="qbsel">${t.qbOptions.map(o => `<option value="${esc(o.id)}"${o.id === t.qbId ? ' selected' : ''}>${esc(o.name)} (${sign(o.pts)} pts)${o.recent ? ' · latest starter' : ''}</option>`).join('')}</select>
      <div class="k">${qbNote(t)}</div></div>` : ''}`;
  const qs = document.getElementById('qbsel');
  if (qs) qs.addEventListener('change', () => {
    const o = t.qbOptions.find(x => x.id === qs.value);
    if (!o || o.recent) delete qbPicks[focus]; else qbPicks[focus] = o.id;
    store.set(pkey('qbpicks'), qbPicks);
    runAll('Re-running with your QB choice…');
  });
  barChart('#windist', t.winDist.map((p, i) => ({ x: String(i), p, tip: `${i} win${i === 1 ? '' : 's'}: ${pct(p, true)}`, alt: i < t.w })), 'wins');
  const seeds = t.seed.slice(1).map((p, i) => ({ x: '#' + (i + 1), p, tip: `#${i + 1} seed: ${pct(p, true)}` }));
  barChart('#seeddist', seeds, 'seed');
  const miss = 1 - t.playoff;
  $('#seedout').textContent = miss <= 0 ? (isFinal() ? 'Made the playoffs' : 'Makes the playoffs in every simulation') : miss >= 1 ? (isFinal() ? 'Missed the playoffs' : 'Misses the playoffs in every simulation') : `Misses the playoffs: ${pct(miss)}`;
  renderNext();
}
function qbNote(t) {
  const o = t.qbOut, cur = t.qbName || 'the current starter';
  const info = o && (season.qbOut || {})[t.abbr];
  if (!o || t.abbr in qbPicks) return "Points are each QB's value from his recent efficiency. The model assumes the latest starter keeps the job unless the regular starter is injured; pick another QB to test a change.";
  const who = esc(o.name || 'The regular starter'), why = info ? esc([info.status, info.injury].filter(Boolean).join(', ').toLowerCase()) : '';
  if (o.cls === 'ir') return `${who} is on injured reserve${info && info.injury ? ` (${esc(info.injury.toLowerCase())})` : ''}, so the odds assume ${esc(cur)} keeps starting. Pick ${who} above to see his return.`;
  return `${who} is ${why || 'injured'}. The odds assume ${esc(cur)} starts Week ${o.listed}, then give ${who} a <b class="num">${pct(o.pNext)}</b> chance of being back the week after, rising to <b class="num">${pct(o.pEnd)}</b> by late in the season (how often injured starters returned, 2012–2025). Pick a QB above to lock in either one.`;
}
function ratingRank(t) { return cur.teams.slice().sort((a, b) => b.rating - a.rating).findIndex(x => x.abbr === t.abbr) + 1; }

function renderNext() {
  const box = $('#nextgame');
  if (!focus) { box.innerHTML = ''; return; }
  const g = cur.upcoming.find(x => (x.home === focus || x.away === focus) && !(x.id in picks));
  if (!g) { box.className = 'nextgame plain'; box.innerHTML = isFinal() ? `<b>Regular season complete.</b> ${playoffStory(focus)}` : '<b>No unpicked games left.</b> Clear a what-if pick to see the next game here.'; return; }
  box.className = 'nextgame';
  const home = g.home === focus, opp = home ? g.away : g.home;
  const pWin = home ? g.pHome : 1 - g.pHome;
  const ln = line(g), sw = swing && swing.id === g.id ? swing : null;
  box.innerHTML = `<div class="ng-main"><div class="ng-when">Next game · Week ${g.week} · ${when(g)}${ln ? ' · line ' + ln : ''}${tvText(g) ? ' · ' + tvText(g) : ''}</div>
      <div class="ng-t">${g.neutral ? 'vs.' : home ? 'vs.' : 'at'} ${esc(M.CITY[opp])} ${esc(M.NAMES[opp])}</div></div>
    <div class="ng-nums">
      <div><span class="v num">${pct(pWin)}</span><span class="k">Chance to win</span></div>
      <div><span class="v num up">${sw ? pct(sw.win) : '…'}</span><span class="k">Playoff chance<br>with a win</span></div>
      <div><span class="v num down">${sw ? pct(sw.lose) : '…'}</span><span class="k">Playoff chance<br>with a loss</span></div>
    </div>`;
}

function barChart(sel, data, kind) {
  const el = $(sel);
  const W = 560, H = 132, padT = 18, padB = 22, n = data.length, gap = 2;
  const bw = (W - gap * (n - 1)) / n, max = Math.max(...data.map(d => d.p), 0.0001);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${kind === 'wins' ? 'Distribution of final win totals' : 'Distribution of playoff seeds'}">`;
  svg += `<line class="axis" x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}"/>`;
  const peak = data.reduce((m, d, i) => (d.p > data[m].p ? i : m), 0);
  data.forEach((d, i) => {
    const x = i * (bw + gap), h = (H - padT - padB) * d.p / max, y = H - padB - h;
    if (h > 0) svg += `<rect class="b${d.alt ? ' alt' : ''}" x="${x}" y="${y}" width="${bw}" height="${h}" rx="${Math.min(3, h / 2)}"/>`;
    svg += `<rect class="hit" x="${x}" y="${padT - 14}" width="${bw}" height="${H - padB - padT + 14}" data-tip="${esc(d.tip)}" data-cx="${x + bw / 2}" data-cy="${y}"/>`;
    svg += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${d.x}</text>`;
    if (i === peak && d.p > 0) svg += `<text class="lbl" x="${x + bw / 2}" y="${y - 5}" text-anchor="middle">${pct(d.p)}</text>`;
  });
  svg += '</svg><div class="tip" hidden></div>';
  el.innerHTML = svg;
  const tip = el.querySelector('.tip'), s = el.querySelector('svg');
  s.addEventListener('pointermove', e => {
    const h = e.target.closest('rect.hit'); if (!h) { tip.hidden = true; return; }
    const sc = s.getBoundingClientRect().width / W;
    tip.textContent = h.dataset.tip; tip.hidden = false;
    tip.style.left = (+h.dataset.cx * sc) + 'px'; tip.style.top = (Math.max(+h.dataset.cy, padT) * sc) + 'px';
  });
  s.addEventListener('pointerleave', () => { tip.hidden = true; });
}

// opt: hidden on phones · r: shown only with "Show QBs and ratings"
const COLS = [
  { k: 'team', label: 'Team' },
  { k: 'rec', label: 'Record' },
  { k: 'projW', label: 'Proj. wins', opt: 1, title: 'Average final win total across the simulated seasons' },
  { k: 'playoff', label: 'Make playoffs', p: 1 },
  { k: 'divWin', label: 'Win division', p: 1 },
  { k: 'bye', label: '#1 seed', p: 1, opt: 1, title: 'Top seed in the conference and the only first-round bye' },
  { k: 'confWin', label: 'Win conf.', p: 1, fine: 1, opt: 1, title: 'Win the conference title game and reach the Super Bowl' },
  { k: 'sbWin', label: 'Win Super Bowl', p: 1, fine: 1 },
  { k: 'qbName', label: 'Starting QB', r: 1, title: 'The latest starter, or your choice (marked *)' },
  { k: 'rating', label: 'Rating', r: 1, title: 'Points better or worse than an average team on a neutral field, from betting lines. The odds use this rating.' },
  { k: 'perf', label: 'Score-only rating', r: 1, title: 'A separate rating built from final scores only, for comparison. See How it works at the bottom of the page.' },
];
let showR = !!store.get('nfl.showratings', false);
function cell(t, col) {
  const cls = [col.opt ? 'opt' : '', col.r ? 'rt' : ''].join(' ').trim();
  const c = (inner, extra, style) => `<td class="${[cls, extra].join(' ').trim()}"${style ? ` style="${style}"` : ''}>${inner}</td>`;
  if (col.k === 'team') return `<td class="team"><button type="button" class="tlink" data-team="${t.abbr}">${chip(t.abbr)}<span class="ab">${t.abbr}</span><span class="nm">${esc(t.name)}</span></button></td>`;
  if (col.k === 'rec') return c(rec(t), 'num');
  if (col.k === 'projW') return c(t.projW.toFixed(1), 'num');
  if (col.k === 'qbName') return c(esc(t.qbName || '—') + (t.abbr in qbPicks ? ' *' : ''), 'dim', 'text-align:left');
  if (col.k === 'rating') return c(sign(t.rating), 'num');
  if (col.k === 'perf') return c(sign(t.perf), 'num dim');
  return c(pct(t[col.k], col.fine), 'pct num', `background:rgba(var(--heat),${(t[col.k] * 0.55).toFixed(3)})`);
}
function renderTable() {
  const c = conf || (focus ? team(cur, focus).conf : 'ALL');
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.conf === c)));
  $('#odds').classList.toggle('showr', showR);
  $('#ratingsbtn').setAttribute('aria-pressed', String(showR));
  $('#ratingsbtn').textContent = showR ? 'Hide QBs and ratings' : 'Show QBs and ratings';
  $('#odds thead').innerHTML = '<tr>' + COLS.map(col => `<th scope="col" class="${[col.opt ? 'opt' : '', col.r ? 'rt' : ''].join(' ').trim()}"${col.title ? ` title="${esc(col.title)}"` : ''}><button type="button" data-k="${col.k}" data-active="${sortKey === col.k || (col.k === 'team' && !sortKey)}">${col.label}${sortKey === col.k ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`).join('') + '</tr>';
  const teams = cur.teams.filter(t => c === 'ALL' || t.conf === c);
  const row = t => `<tr class="${t.abbr === focus ? 'me' : ''}">` + COLS.map(col => cell(t, col)).join('') + '</tr>';
  let html = '';
  if (!sortKey) {
    for (const d of Object.keys(M.DIV).filter(d => c === 'ALL' || d.startsWith(c))) {
      html += `<tr class="divhead"><td colspan="${COLS.length}">${d}</td></tr>`;
      teams.filter(t => t.div === d).sort((a, b) => b.divWin - a.divWin).forEach(t => { html += row(t); });
    }
  } else {
    const val = t => sortKey === 'rec' ? (t.w + t.t / 2) / Math.max(1, t.w + t.l + t.t) : sortKey === 'qbName' ? (t.qbPts ?? -99) : t[sortKey];
    teams.slice().sort((a, b) => sortDir * (val(a) - val(b)) || b.playoff - a.playoff).forEach(t => { html += row(t); });
  }
  $('#odds tbody').innerHTML = html;
}
$('#ratingsbtn').addEventListener('click', () => { showR = !showR; store.set('nfl.showratings', showR); renderTable(); });

let schedMode = store.get('nfl.schedmode', 'week');
function seasonRows() {
  const ix = Object.fromEntries(season.fields.map((k, i) => [k, i]));
  return season.games.map(r => ({ id: r[ix.id], week: r[ix.week], date: r[ix.date], time: r[ix.time], away: r[ix.away], home: r[ix.home],
    as: r[ix.awayScore], hs: r[ix.homeScore], spread: r[ix.spread], neutral: !!r[ix.neutral], stadium: ix.stadium !== undefined ? r[ix.stadium] || '' : '' }));
}
function gameCard(g, showWeek) {
  const me = g.home === focus || g.away === focus;
  // Fixed structure so every card in a row is the same height: one line for time and line, one for the venue.
  const ln0 = line(g);
  const top = `<div class="when">${showWeek ? `<span class="wk">Week ${g.week}</span> · ` : ''}${when(g)}${ln0 ? ' · line ' + ln0 : ''}</div>`;
  const place = `<div class="when" title="${venue(g)}">${venue(g) || '&nbsp;'}</div>`;
  const final = g.hs !== null && g.hs !== undefined;
  if (final) {
    const hw = g.hs > g.as, tie = g.hs === g.as;
    const fav = g.spread > 0 ? g.home : g.spread < 0 ? g.away : null;
    const upset = !tie && fav && fav !== (hw ? g.home : g.away);
    const side = (t, sc, won, right) => `<div class="side ${tie ? '' : won ? 'w' : 'l'}">${right ? `<span class="sc">${sc}</span><span class="t">${chip(t)}${esc(M.NAMES[t])}</span>` : `<span class="t">${chip(t)}${esc(M.NAMES[t])}</span><span class="sc">${sc}</span>`}</div>`;
    return `<div class="game done${me ? ' me' : ''}">${top}${place}
      <div class="res">${side(g.away, g.as, !hw, false)}<span class="mid">${upset ? '<span class="tag" title="The underdog won">Upset</span>' : tie ? 'tie' : 'final'}</span>${side(g.home, g.hs, hw, true)}</div></div>`;
  }
  const pk = picks[g.id], pH = baseP(g.id), tv = tvText(g);
  return `<div class="game${me ? ' me' : ''}">${top}${place}
      <div class="when tv">${tv || '&nbsp;'}</div>
      <div class="pick" role="group" aria-label="${esc(M.NAMES[g.away])} ${g.neutral ? 'vs.' : 'at'} ${esc(M.NAMES[g.home])}">
        <button type="button" data-g="${g.id}" data-t="${g.away}" aria-pressed="${pk === g.away}"><span class="t">${chip(g.away)}${esc(M.NAMES[g.away])}</span><span class="p num">${pct(1 - pH)}</span></button>
        <button type="button" class="mid" data-g="${g.id}" data-t="" aria-pressed="${!pk}"${pk ? ' aria-label="Clear this pick" title="Clear this pick"' : ''}>${pk ? '✕' : g.neutral ? 'vs' : 'at'}</button>
        <button type="button" data-g="${g.id}" data-t="${g.home}" aria-pressed="${pk === g.home}"><span class="t">${chip(g.home)}${esc(M.NAMES[g.home])}</span><span class="p num">${pct(pH)}</span></button>
      </div>
    </div>`;
}
function renderWhatIf() {
  const all = seasonRows();
  const weeks = [...new Set(all.map(g => g.week))].sort((a, b) => a - b);
  const openWeeks = [...new Set(base.upcoming.map(g => g.week))].sort((a, b) => a - b);
  if (week === null || !weeks.includes(week)) week = openWeeks.length ? openWeeks[0] : weeks[weeks.length - 1];
  if (schedMode === 'team' && !focus) schedMode = 'week';
  document.querySelectorAll('#schedmode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === schedMode)));
  const tb = $('#schedteam'); tb.textContent = focus ? M.NAMES[focus] : 'Your team'; tb.disabled = !focus; tb.title = focus ? '' : 'Pick a team first';
  $('#weeks').hidden = schedMode === 'team';
  $('#weeks').innerHTML = weeks.map(w => {
    const has = all.some(g => g.week === w && (g.home === focus || g.away === focus));
    const n = all.filter(g => g.week === w && g.id in picks).length;
    return `<button type="button" data-w="${w}" aria-pressed="${w === week}">Wk ${w}${n ? ` · ${n}` : ''}${has ? '<span class="dot" aria-label="includes your team"></span>' : ''}</button>`;
  }).join('');
  const gs = schedMode === 'team' ? all.filter(g => g.home === focus || g.away === focus) : all.filter(g => g.week === week);
  gs.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')) || a.id.localeCompare(b.id));
  $('#games').innerHTML = gs.map(g => gameCard(g, schedMode === 'team')).join('') || '<p class="status">No games this week.</p>';
  const n = Object.keys(picks).length, nq = Object.keys(qbPicks).length;
  $('#pickbar').hidden = isFinal() && !n && !nq;
  $('#whatif-note').hidden = isFinal();
  $('#pickcount').textContent = (n ? `${n} pick${n > 1 ? 's' : ''} locked in` : 'No picks yet') + (nq ? ` · ${nq} QB choice${nq > 1 ? 's' : ''}` : '');
  $('#clearpicks').disabled = !(n + nq);
}
$('#schedmode').addEventListener('click', e => {
  const b = e.target.closest('button[data-mode]'); if (!b || b.disabled) return;
  schedMode = b.dataset.mode; store.set('nfl.schedmode', schedMode); renderWhatIf();
});
function favText(x, g) {
  if (Math.abs(x) < 0.05) return 'Pick’em';
  return x > 0 ? `${g.home} −${x.toFixed(1)}` : `${g.away} −${(-x).toFixed(1)}`;
}
function renderVs() {
  const C = PERF_CONST;
  const gs = base.upcoming.filter(g => g.spread !== null && g.spread !== undefined);
  const tb = $('#vs tbody');
  if (!gs.length) { tb.innerHTML = '<tr><td colspan="6" class="dim">No market lines posted yet for upcoming games.</td></tr>'; }
  else tb.innerHTML = gs.map(g => {
    const ours = PerfModel.line(PR, C, g), gap = ours - g.spread;
    const lean = Math.abs(gap) < 0.05 ? '—' : (gap > 0 ? g.home : g.away) + ` by ${Math.abs(gap).toFixed(1)}`;
    const me = g.home === focus || g.away === focus;
    return `<tr class="${me ? 'me' : ''}"><td class="team"><span class="ab">${g.away}</span> at <span class="ab" style="width:auto">${g.home}</span></td>` +
      `<td class="dim">${when(g)}</td><td class="num">${line(g)}</td><td class="num">${favText(ours, g)}</td>` +
      `<td class="num">${Math.abs(gap).toFixed(1)}</td><td>${lean}${Math.abs(gap) >= 6 ? '<span class="flag">6+ pts</span>' : ''}</td></tr>`;
  }).join('');
  const t6 = C.test.ats.find(x => x.th === 6), r6 = C.train.ats.find(x => x.th === 6);
  $('#vs-note').innerHTML = `Our line is the predicted home margin from our rating plus ${C.params.hfa} points of home field. "We lean" is the side our rating likes compared with the market line. Gaps of 6 or more points went ${t6.w}–${t6.l} (${(t6.pct * 100).toFixed(1)}%) in the 2018–2025 test but ${r6.w}–${r6.l} (${(r6.pct * 100).toFixed(1)}%) in 2002–2017. Samples that small swing either way, so even big gaps show no reliable edge.`;

  const T = C.test, bs = C.by_season;
  const better = bs.filter(s => s.rmse_market < s.rmse_model).length;
  const all = T.ats[0];
  $('#bt-stats').innerHTML = `
    <div class="stat"><div class="v num">${better} of ${bs.length}</div><div class="k">Test seasons where the market was more accurate</div></div>
    <div class="stat"><div class="v num">${T.rmse_model.toFixed(1)} vs ${T.rmse_market.toFixed(1)}</div><div class="k">Average miss in points, ours vs. market</div></div>
    <div class="stat"><div class="v num">${(T.su_model * 100).toFixed(1)}% vs ${(T.su_market * 100).toFixed(1)}%</div><div class="k">Winners picked, ours vs. market</div></div>
    <div class="stat"><div class="v num">${(all.pct * 100).toFixed(1)}%</div><div class="k">Against the spread on every game (${all.w.toLocaleString()}–${all.l.toLocaleString()}). Break-even is 52.4%.</div></div>`;
  $('#bt-seasons tbody').innerHTML = bs.map(s => `<tr><td>${s.season}</td><td class="num">${s.rmse_model.toFixed(2)}</td><td class="num"><b>${s.rmse_market.toFixed(2)}</b></td><td class="num">${(s.su_model * 100).toFixed(1)}%</td><td class="num">${(s.su_market * 100).toFixed(1)}%</td></tr>`).join('');
  atsChart(T.ats);
}
function atsChart(ats) {
  const el = $('#atschart');
  const W = 520, H = 210, L = 40, R = 12, T = 12, B = 40, lo = 0.44, hi = 0.58;
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const n = ats.length, step = (W - L - R) / n;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Against-the-spread win rate by size of disagreement, 2018 to 2025">`;
  for (let v = 0.44; v <= 0.5801; v += 0.02) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v * 100)}%</text>`;
  s += `<line class="even" x1="${L}" x2="${W - R}" y1="${y(0.5)}" y2="${y(0.5)}"/>`;
  s += `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(0.5238)}" y2="${y(0.5238)}"/>`;
  s += `<text class="lbl" x="${L + 6}" y="${y(0.5238) - 5}">Break-even 52.4%</text>`;
  ats.forEach((a, i) => {
    const cx = L + step * (i + 0.5), bw = Math.min(34, step * 0.55), top = y(Math.max(lo, Math.min(hi, a.pct)));
    const base0 = y(0.5);
    s += `<rect class="b" x="${cx - bw / 2}" y="${Math.min(top, base0)}" width="${bw}" height="${Math.max(2, Math.abs(base0 - top))}" rx="2"/>`;
    s += `<rect class="hit" x="${cx - step / 2}" y="${T}" width="${step}" height="${H - T - B}" data-tip="${a.th ? a.th + '+ point gap' : 'Every game'}: ${a.w}–${a.l} (${(a.pct * 100).toFixed(1)}%)" data-cx="${cx}" data-cy="${top}"/>`;
    s += `<text x="${cx}" y="${H - B + 16}" text-anchor="middle" class="lbl">${a.th ? a.th + '+' : 'All'}</text>`;
    s += `<text x="${cx}" y="${H - B + 30}" text-anchor="middle">${a.bets.toLocaleString()}</text>`;
  });
  s += `</svg><div class="tip" hidden></div>`;
  el.innerHTML = s;
  const tip = el.querySelector('.tip'), svg = el.querySelector('svg');
  svg.addEventListener('pointermove', e => {
    const h = e.target.closest('rect.hit'); if (!h) { tip.hidden = true; return; }
    const sc = svg.getBoundingClientRect().width / W;
    tip.textContent = h.dataset.tip; tip.hidden = false;
    tip.style.left = (+h.dataset.cx * sc) + 'px'; tip.style.top = (+h.dataset.cy * sc) + 'px';
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });
}

// ---- playoff bracket (shown once the regular season is complete) ----
const ROUNDS = ['', 'Wild Card', 'Divisional', 'Conference', 'Super Bowl'];
function poGames() {
  if (!Array.isArray(season.playoffs) || !season.playoffFields) return [];
  const ix = Object.fromEntries(season.playoffFields.map((k, i) => [k, i]));
  return season.playoffs.map(r => ({ id: r[ix.id], round: r[ix.round], date: r[ix.date], time: r[ix.time], away: r[ix.away], home: r[ix.home], as: r[ix.awayScore], hs: r[ix.homeScore] }));
}
function poWinner(g) { return g.as === null || g.as === undefined ? null : (g.hs > g.as ? g.home : g.away); }
function poSeeds() { try { return M.seedSeason(season); } catch (e) { return null; } }
function poCard(g, seedOf) {
  if (!g) return '<div class="po-game"><div class="row lose"><span class="sd"></span><span class="nm">To be decided</span><span></span></div><div class="row lose"><span class="sd"></span><span class="nm">&nbsp;</span><span></span></div></div>';
  const w = poWinner(g);
  const row = (t, sc) => `<div class="row${w ? (t === w ? ' win' : ' lose') : ''}${t === focus ? ' me' : ''}"><span class="sd">${seedOf(t) || ''}</span><span class="nm">${chip(t)}${esc(M.NAMES[t] || t)}</span><span class="sc">${sc === null || sc === undefined ? '' : sc}</span></div>`;
  return `<div class="po-game">${row(g.away, g.as)}${row(g.home, g.hs)}${w ? '' : `<div class="when">${when(g)}</div>`}</div>`;
}
function renderBracket() {
  const sec = $('#po-sec');
  if (!base || !isFinal()) { sec.hidden = true; return; }
  const seeds = poSeeds(); if (!seeds) { sec.hidden = true; return; }
  sec.hidden = false;
  const games = poGames();
  const seedOf = t => { for (const c of ['AFC', 'NFC']) { const i = seeds[c].indexOf(t); if (i >= 0) return '#' + (i + 1); } return ''; };
  const pair = (a, b) => games.find(g => (g.home === a && g.away === b) || (g.home === b && g.away === a));
  const inConf = (g, c) => seeds[c].includes(g.home) || seeds[c].includes(g.away);
  let html = '';
  for (const c of ['AFC', 'NFC']) {
    const s = seeds[c];
    const wc = [[1, 6], [2, 5], [3, 4]].map(([a, b]) => pair(s[a], s[b]));
    const dv = games.filter(g => g.round === 2 && inConf(g, c)).sort((x, y) => (s.indexOf(x.home) - s.indexOf(y.home)));
    const cf = games.find(g => g.round === 3 && inConf(g, c));
    html += `<div class="po-conf"><h3>${c}</h3><div class="po-rounds">
      <div class="po-round"><span class="rt">${ROUNDS[1]}</span><div class="po-bye">#1 ${esc(M.NAMES[s[0]])}${s[0] === focus ? ' (your team)' : ''}: first-round bye</div>${wc.map(g => poCard(g, seedOf)).join('')}</div>
      <div class="po-round"><span class="rt">${ROUNDS[2]}</span>${[dv[0], dv[1]].map(g => poCard(g, seedOf)).join('')}</div>
      <div class="po-round"><span class="rt">${ROUNDS[3]} title</span>${poCard(cf, seedOf)}</div>
    </div></div>`;
  }
  const sb = games.find(g => g.round === 4);
  const sbName = (PRI.sb || CFG.sb || {}).name || 'Super Bowl';
  html += `<div class="po-conf po-sb"><h3>${esc(sbName)}</h3>${poCard(sb, seedOf)}</div>`;
  $('#po-grid').innerHTML = html;
  const champ = sb && poWinner(sb);
  const ch = $('#champ');
  ch.hidden = !champ;
  if (champ) ch.innerHTML = `<b>${esc(M.CITY[champ])} ${esc(M.NAMES[champ])}</b> won ${esc(sbName)}, ${Math.max(sb.as, sb.hs)}–${Math.min(sb.as, sb.hs)} over the ${esc(M.NAMES[champ === sb.home ? sb.away : sb.home])}.`;
  const done = games.filter(g => poWinner(g)).length;
  $('#po-status').textContent = !games.length ? 'Seeds are set; matchups appear once the data lists them.' : champ ? 'Final' : `${done} of 13 playoff games played`;
}
function playoffStory(t) {
  const seeds = poSeeds(); if (!seeds) return '';
  const conf = seeds.AFC.includes(t) ? 'AFC' : seeds.NFC.includes(t) ? 'NFC' : null;
  if (!conf) return `The ${esc(M.NAMES[t])} missed the playoffs.`;
  const seed = seeds[conf].indexOf(t) + 1;
  const mine = poGames().filter(g => g.home === t || g.away === t).sort((a, b) => a.round - b.round);
  const lost = mine.find(g => poWinner(g) && poWinner(g) !== t);
  const sbName = (PRI.sb || CFG.sb || {}).name || 'the Super Bowl';
  if (lost) { const opp = lost.home === t ? lost.away : lost.home; const us = lost.home === t ? lost.hs : lost.as, them = lost.home === t ? lost.as : lost.hs;
    return `The #${seed} seed ${esc(M.NAMES[t])} lost ${them}–${us} to the ${esc(M.NAMES[opp])} in the ${lost.round === 4 ? esc(sbName) : ROUNDS[lost.round] + ' round'}.`; }
  const sb = mine.find(g => g.round === 4 && poWinner(g) === t);
  if (sb) return `The #${seed} seed ${esc(M.NAMES[t])} won ${esc(sbName)}.`;
  return `The ${esc(M.NAMES[t])} are the #${seed} seed${mine.length ? ' and still alive' : ''}.`;
}

// ---- who to root for (from data/rooting-YEAR.json, computed by the refresh) ----
let ROOT = null, rootToken = '';
function validRooting(d) {
  try {
    const okT = o => o && typeof o === 'object' && M.TEAMS.every(t => Array.isArray(o[t]) && o[t].length === 3 && o[t].every(v => Number.isInteger(v) && v >= 0 && v <= 1000));
    return !!d && d.season === YEAR && Number.isInteger(d.week) && typeof d.basedOn === 'string' && okT(d.base) && Array.isArray(d.games) && d.games.length <= 20 &&
      d.games.every(g => RX.gid.test(g.id) && M.TEAMS.includes(g.away) && M.TEAMS.includes(g.home) && Number.isInteger(g.pHome) && okT(g.ifHome) && okT(g.ifAway));
  } catch (e) { return false; }
}
async function loadRooting() {
  const token = YEAR + '|' + season.updatedAt;
  if (!DB || token === rootToken) return;
  rootToken = token; ROOT = null;
  try { const s = await DB.doc('rooting/' + YEAR).get(); if (token === rootToken && s.exists && validRooting(s.data())) { ROOT = s.data(); renderRoot(); } } catch (e) {}
}
function renderRoot() {
  const box = $('#rootbox');
  const ok = focus && ROOT && ROOT.season === YEAR && ROOT.basedOn === season.updatedAt && !isFinal();
  box.hidden = !ok; if (!ok) return;
  const nm = M.NAMES[focus], b = ROOT.base[focus];
  const m = b[0] >= 950 && b[1] < 950 ? 1 : b[0] >= 950 ? 2 : 0;            // playoffs, else division, else #1 seed
  const goal = ['playoff chance', 'chance to win the division', 'chance at the #1 seed'][m];
  const rowsById = Object.fromEntries(seasonRows().map(g => [g.id, g]));
  const f1 = v => (v / 10).toFixed(1) + '%';
  const list = ROOT.games.filter(g => g.home !== focus && g.away !== focus).map(g => {
    const d = g.ifHome[focus][m] - g.ifAway[focus][m], root = d >= 0 ? g.home : g.away, vs = d >= 0 ? g.away : g.home;
    return { g, d: Math.abs(d), root, vs, yes: (d >= 0 ? g.ifHome : g.ifAway)[focus][m], no: (d >= 0 ? g.ifAway : g.ifHome)[focus][m] };
  }).sort((x, y) => y.d - x.d);
  const top = list.filter(x => x.d >= 5).slice(0, 6);
  const picked = Object.keys(picks).length + Object.keys(qbPicks).length > 0;
  box.innerHTML = `<h3>Who to root for in Week ${ROOT.week}</h3>
    <p class="k-note">Other games this week, ranked by how much each result changes the ${esc(nm)}' ${goal}.${picked ? ' Based on the odds without your What If picks.' : ''}</p>
    ${top.length ? `<ul class="rootlist">${top.map(x => { const r = rowsById[x.g.id] || x.g;
      return `<li><div class="rt"><span class="who">${chip(x.root)}${esc(M.NAMES[x.root])} <span class="ov">over the ${esc(M.NAMES[x.vs])}</span></span><span class="gain">+${(x.d / 10).toFixed(1)} pts</span></div>
        <div class="det">${f1(x.yes)} if the ${esc(M.NAMES[x.root])} win, ${f1(x.no)} if the ${esc(M.NAMES[x.vs])} do · ${when(r)}</div></li>`; }).join('')}</ul>`
      : `<p class="note">No other game this week changes the ${esc(nm)}' ${goal} by more than half a point.</p>`}`;
}

// ---- projected playoff bracket (during the regular season) ----
function renderProjected() {
  const sec = $('#proj-sec');
  if (!cur || isFinal()) { sec.hidden = true; return; }
  sec.hidden = false;
  const T = Object.fromEntries(cur.teams.map(t => [t.abbr, t])), sd = cur.sd || 11.5;
  const wp = (h, a, neutral) => M.Phi((T[h].rating - T[a].rating + (neutral ? 0 : cur.hfa)) / sd);   // home (or first) team's win chance
  const card = (hi, lo, seedOf, neutral, first) => {
    const p = wp(hi, lo, neutral), win = p >= 0.5 ? hi : lo;
    const row = (t, v) => `<div class="row${t === win ? ' win' : ' lose'}${t === focus ? ' me' : ''}"><span class="sd">#${seedOf(t)}</span><span class="nm">${chip(t)}${esc(M.NAMES[t])}</span><span class="sc pr">${v}</span></div>`;
    const v = t => pct(t === hi ? p : 1 - p);
    return { html: `<div class="po-game">${row(lo, v(lo))}${row(hi, v(hi))}</div>`, win };
  };
  let html = '', champs = {};
  for (const c of ['AFC', 'NFC']) {
    const divs = Object.keys(M.DIV).filter(d => d.startsWith(c));
    const dw = divs.map(d => M.DIV[d].slice().sort((a, b) => T[b].divWin - T[a].divWin)[0]);
    const byWins = (a, b) => T[b].projW - T[a].projW || T[b].bye - T[a].bye;
    dw.sort(byWins);
    const wc = cur.teams.filter(t => t.conf === c && !dw.includes(t.abbr)).sort((a, b) => b.playoff - a.playoff).slice(0, 3).map(t => t.abbr).sort(byWins);
    const seeds = [...dw, ...wc], seedOf = t => seeds.indexOf(t) + 1;
    const wcg = [[1, 6], [2, 5], [3, 4]].map(([x, y]) => card(seeds[x], seeds[y], seedOf, false, true));
    const alive = [seeds[0], ...wcg.map(g => g.win)].sort((a, b) => seedOf(a) - seedOf(b));
    const d1 = card(alive[0], alive[3], seedOf, false, false), d2 = card(alive[1], alive[2], seedOf, false, false);
    const [hi, lo] = [d1.win, d2.win].sort((a, b) => seedOf(a) - seedOf(b));
    const cf = card(hi, lo, seedOf, false, false);
    champs[c] = { t: cf.win, seedOf };
    html += `<div class="po-conf"><h3>${c}</h3><p class="k-note seedline">Chance to make the playoffs: ${seeds.map((t, i) => `#${i + 1} ${esc(M.NAMES[t])} ${pct(T[t].playoff)}`).join(' · ')}</p><div class="po-rounds">
      <div class="po-round"><span class="rt">${ROUNDS[1]}</span><div class="po-bye">#1 ${chip(seeds[0])}${esc(M.NAMES[seeds[0]])}: first-round bye</div>${wcg.map(g => g.html).join('')}</div>
      <div class="po-round"><span class="rt">${ROUNDS[2]}</span>${d1.html}${d2.html}</div>
      <div class="po-round"><span class="rt">${ROUNDS[3]} title</span>${cf.html}</div>
    </div></div>`;
  }
  const sbName = (PRI.sb || CFG.sb || {}).name || 'Super Bowl';
  const a = champs.AFC.t, n = champs.NFC.t, pA = wp(a, n, true), win = pA >= 0.5 ? a : n;
  const row = (t, p, so) => `<div class="row${t === win ? ' win' : ' lose'}${t === focus ? ' me' : ''}"><span class="sd">${t === a ? 'AFC' : 'NFC'}</span><span class="nm">${chip(t)}${esc(M.NAMES[t])}</span><span class="sc pr">${pct(p)}</span></div>`;
  html += `<div class="po-conf po-sb"><h3>${esc(sbName)}</h3><div class="po-game">${row(a, pA)}${row(n, 1 - pA)}</div></div>`;
  $('#proj-grid').innerHTML = html;
  $('#proj-champ').innerHTML = `<b>${esc(M.CITY[win])} ${esc(M.NAMES[win])}</b> would be favored in every game along this path. Their actual chance of winning ${esc(sbName)} is ${pct(T[win].sbWin, true)}: even the likeliest champion usually doesn't win it.`;
}

// ---- league overview, team picker, team links ----
const ALIAS = { LAR: 'LA', JAC: 'JAX', WSH: 'WAS', OAK: 'LV', SD: 'LAC', STL: 'LA' };
function hashTeam() { const h = decodeURIComponent((location.hash || '').slice(1)).toUpperCase(); const t = ALIAS[h] || h; return M.TEAMS.includes(t) ? t : null; }
const tl = t => `<button type="button" class="tlink${t === focus ? ' me' : ''}" data-team="${t}">${chip(t)}${esc(M.NAMES[t])}</button>`;
function setFocus(t, scroll) {
  if (!M.TEAMS.includes(t)) return;
  focus = t; store.set('nfl26.focus', focus);
  try { history.replaceState(null, '', '#' + t); } catch (e) {}
  fillTeams();
  if (!cur) return;                          // first simulation still running; it will render this team
  renderAll(); runSwing(); renderHistory();
  if (scroll) jumpTo($('#focus-sec'));
}
function fillTeams() {
  const opts = M.TEAMS.map(t => [t, M.NAMES[t]]).sort((a, b) => a[1].localeCompare(b[1]));
  $('#teamsel').innerHTML = (focus ? '' : '<option value="" selected>Choose a team…</option>') + opts.map(([t, n]) => `<option value="${t}"${t === focus ? ' selected' : ''}>${esc(n)}</option>`).join('');
}
function renderPicker() {
  const pk = $('#picker'), fc = $('#focus');
  pk.hidden = !!focus; fc.hidden = !focus;
  if (focus) return;
  pk.innerHTML = `<p><b>Pick a team to follow.</b> You'll get its playoff chances, likely win total, next game, and how its odds have moved. You can switch anytime, and this browser remembers your choice.</p>
    <div class="picker-grid">${Object.entries(M.DIV).map(([d, ts]) => `<div class="pd"><span>${d}</span>${ts.map(t => `<button type="button" data-team="${t}">${chip(t)}${esc(M.NAMES[t])}</button>`).join('')}</div>`).join('')}</div>`;
}
function renderOverview() {
  const sec = $('#ov-sec');
  if (!cur || isFinal()) { sec.hidden = true; return; }
  sec.hidden = false;
  const T = cur.teams;
  const top = T.slice().sort((a, b) => b.sbWin - a.sbWin).slice(0, 6), mx = top[0].sbWin || 1;
  $('#ov-sb').innerHTML = top.map((t, i) => `<li title="${esc(M.NAMES[t.abbr])}: ${pct(t.sbWin, true)} chance to win the Super Bowl"><span class="rk">${i + 1}</span><div>${tl(t.abbr)} <span class="dim">${rec(t)}</span><div class="bar"><i style="width:${(t.sbWin / mx * 100).toFixed(1)}%"></i></div></div><span class="pv">${pct(t.sbWin, true)}</span></li>`).join('');
  $('#ov-div').innerHTML = Object.keys(M.DIV).map(d => { const t = T.filter(x => x.div === d).sort((a, b) => b.divWin - a.divWin)[0];
    return `<div class="d"><span class="dn">${d}</span>${tl(t.abbr)} <span class="pv">${pct(t.divWin)}</span></div>`; }).join('');
  const mvEl = $('#ov-move');
  if (!HIST) { mvEl.innerHTML = '<p class="status">Calculating…</p>'; return; }
  if (HIST.length < 2) { mvEl.innerHTML = '<p class="status">Moves appear after Week 1.</p>'; return; }
  const a = HIST[HIST.length - 2].teams, z = HIST[HIST.length - 1].teams;
  const ch = M.TEAMS.map(t => ({ t, d: z[t][0] - a[t][0] })).sort((x, y) => y.d - x.d);
  const fmt = d => `${d > 0 ? '▲' : '▼'} ${Math.abs(d * 100).toFixed(0)} pts`;
  const up = ch.slice(0, 3).filter(x => x.d > 0.005), dn = ch.slice(-3).reverse().filter(x => x.d < -0.005);
  mvEl.innerHTML = `<div class="mv">${up.map(x => `<div>${tl(x.t)}</div><div class="up">${fmt(x.d)}</div>`).join('')}${dn.map(x => `<div>${tl(x.t)}</div><div class="down">${fmt(x.d)}</div>`).join('')}</div>`;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-team]'); if (b) setFocus(b.dataset.team, true); });

// ---- section nav ----
const NAV = $('#secnav');
const navBtns = () => [...NAV.querySelectorAll('[data-jump]')];
function updateNav() {
  navBtns().forEach(b => { const el = document.getElementById(b.dataset.jump); b.hidden = !el || el.hidden; });
  $('#nav-team').textContent = focus ? M.NAMES[focus] : 'Your team';
  markNav();
}
let navCur = null;
function markNav() {
  let on = null;
  for (const b of navBtns()) { if (b.hidden) continue; if (document.getElementById(b.dataset.jump).getBoundingClientRect().top <= 110) on = b; }
  if (on === navCur) return;
  navCur = on;
  navBtns().forEach(b => b.setAttribute('aria-current', String(b === on)));
  if (on && (on.offsetLeft < NAV.scrollLeft || on.offsetLeft + on.offsetWidth > NAV.scrollLeft + NAV.clientWidth)) NAV.scrollLeft = on.offsetLeft - 8;
}
let navTick = false;
window.addEventListener('scroll', () => { if (navTick) return; navTick = true; requestAnimationFrame(() => { navTick = false; markNav(); }); }, { passive: true });
NAV.addEventListener('click', e => {
  const b = e.target.closest('[data-jump]'); if (!b) return;
  const el = document.getElementById(b.dataset.jump); if (!el) return;
  jumpTo(el);
});
// scroll to a section; if something above it finished drawing and grew meanwhile, settle on it once scrolling stops
function jumpTo(el) {
  el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  let done = false;
  const fix = () => { if (done) return; done = true; window.removeEventListener('scrollend', fix); const off = el.getBoundingClientRect().top - (parseFloat(getComputedStyle(el).scrollMarginTop) || 0); if (Math.abs(off) > 8) el.scrollIntoView({ block: 'start' }); };
  window.addEventListener('scrollend', fix);
  setTimeout(fix, 1200);
}
window.addEventListener('hashchange', () => { const t = hashTeam(); if (t && t !== focus) setFocus(t, true); });

function baseP(id) { const g = base.upcoming.find(x => x.id === id); return g ? g.pHome : 0.5; }

// ---- events ----
document.querySelector('.seg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  conf = b.dataset.conf; store.set('nfl26.conf', conf); renderTable();
});
$('#odds thead').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const k = b.dataset.k;
  if (k === 'team') sortKey = null;
  else if (sortKey === k) sortDir = -sortDir;
  else { sortKey = k; sortDir = -1; }
  renderTable();
});
$('#weeks').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  week = +b.dataset.w; renderWhatIf();
});
$('#games').addEventListener('click', e => {
  const b = e.target.closest('button[data-g]'); if (!b) return;
  const id = b.dataset.g, t = b.dataset.t;
  if (!t || picks[id] === t) delete picks[id]; else picks[id] = t;
  store.set(pkey('picks'), picks);
  renderWhatIf();
  runAll('Re-running with your picks…');
});
$('#clearpicks').addEventListener('click', () => { picks = {}; qbPicks = {}; store.set(pkey('picks'), picks); store.set(pkey('qbpicks'), qbPicks); runAll('Re-running without picks…'); });
const sel = $('#teamsel');
sel.addEventListener('change', () => { if (sel.value) setFocus(sel.value, false); });

function renderHistory() {
  const el = $('#histchart');
  if (!focus) { el.innerHTML = '<p class="status">Pick a team above to see how its chances moved week by week.</p>'; $('#histlegend').innerHTML = ''; return; }
  if (!HIST) { el.innerHTML = '<p class="status">Replaying the season week by week…</p>'; $('#histlegend').innerHTML = ''; return; }
  const S = [{ k: 0, label: 'Make playoffs', cls: 's1', col: 'var(--bar)' }, { k: 1, label: 'Win division', cls: 's2', col: 'var(--accent)' }, { k: 2, label: 'Win Super Bowl', cls: 's3', col: 'var(--ink-3)' }];
  $('#histlegend').innerHTML = S.map(s => `<span><i style="background:${s.col}"></i>${s.label}</span>`).join('');
  const pts = HIST.map(h => ({ week: h.week, v: h.teams[focus] || [0, 0, 0] }));
  const W = 900, H = 260, L = 44, R = 110, T = 14, B = 30, n = pts.length;
  const x = i => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1));
  const y = v => T + (1 - v) * (H - T - B);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(M.NAMES[focus])} odds after each week">`;
  for (const g of [0, 0.25, 0.5, 0.75, 1]) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}"/><text x="${L - 8}" y="${y(g) + 4}" text-anchor="end">${g * 100}%</text>`;
  pts.forEach((p, i) => { s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${p.week === 0 ? 'Pre' : 'Wk ' + p.week}</text>`; });
  for (const sr of S) {
    s += `<polyline class="${sr.cls}" points="${pts.map((p, i) => `${x(i)},${y(p.v[sr.k])}`).join(' ')}"/>`;
    pts.forEach((p, i) => { s += `<circle class="${sr.cls}d" cx="${x(i)}" cy="${y(p.v[sr.k])}" r="${i === n - 1 ? 5 : 3.5}"/>`; });
  }
  // direct labels at the right end, nudged apart so they never overlap
  const ends = S.map(sr => ({ sr, v: pts[n - 1].v[sr.k], yy: y(pts[n - 1].v[sr.k]) })).sort((a, b) => b.yy - a.yy);
  for (let i = 0; i < ends.length; i++) ends[i].yy = Math.min(ends[i].yy, i ? ends[i - 1].yy - 15 : H - B - 2);   // stack upward so labels never overlap
  for (const e of ends) s += `<text class="lbl" x="${x(n - 1) + 10}" y="${Math.max(T + 8, e.yy) + 4}">${e.v === 0 ? '0%' : pct(e.v, true)} ${e.sr.label.replace('Win ', '').replace('Make ', '')}</text>`;
  s += `<line class="cross" id="hx" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
  pts.forEach((p, i) => { const w = (W - L - R) / Math.max(1, n - 1); s += `<rect class="hit" x="${x(i) - w / 2}" y="${T}" width="${w}" height="${H - T - B}" data-i="${i}"/>`; });
  s += '</svg><div class="tip multi" hidden></div>';
  el.innerHTML = s;
  const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), hx = svg.querySelector('#hx');
  svg.addEventListener('pointermove', e => {
    const h = e.target.closest('rect.hit'); if (!h) { tip.hidden = true; hx.setAttribute('visibility', 'hidden'); return; }
    const i = +h.dataset.i, p = pts[i], sc = svg.getBoundingClientRect().width / W;
    hx.setAttribute('x1', x(i)); hx.setAttribute('x2', x(i)); hx.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>${p.week === 0 ? 'Before Week 1' : 'After Week ' + p.week}</b><br>` + S.map(sr => `${sr.label}: ${pct(p.v[sr.k], true)}`).join('<br>');
    tip.hidden = false; tip.style.left = (x(i) * sc + 16) + 'px'; tip.style.top = (T * sc + 70) + 'px';
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; hx.setAttribute('visibility', 'hidden'); });
}

// ---- seasons and live data ----
// Data files are checked before use, so a malformed or tampered file can't inject anything into the page.
const RX = { gid: /^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/, pid: /^[0-9A-Za-z-]{1,20}$/, date: /^\d{4}-\d{2}-\d{2}$/, time: /^(\d{2}:\d{2})?$/ };
const okNum = v => v === null || v === undefined || (typeof v === 'number' && isFinite(v));
function validSeason(d) {
  try {
    if (!d || !Array.isArray(d.games) || !Array.isArray(d.fields)) return false;
    const ix = Object.fromEntries(d.fields.map((k, i) => [k, i]));
    const okGame = (r, ixx) => RX.gid.test(r[ixx.id]) && M.TEAMS.includes(r[ixx.away]) && M.TEAMS.includes(r[ixx.home]) &&
      RX.date.test(r[ixx.date]) && RX.time.test(r[ixx.time] || '') && okNum(r[ixx.awayScore]) && okNum(r[ixx.homeScore]);
    for (const r of d.games) {
      if (!okGame(r, ix) || !okNum(r[ix.spread])) return false;
      if (ix.stadium !== undefined && !(typeof r[ix.stadium] === 'string' && /^[A-Za-z0-9 &'.-]{0,60}$/.test(r[ix.stadium]))) return false;
      if (ix.awayQB !== undefined && ((r[ix.awayQB] && !RX.pid.test(r[ix.awayQB])) || (r[ix.homeQB] && !RX.pid.test(r[ix.homeQB])))) return false;
    }
    if (d.playoffs) { const px = Object.fromEntries(d.playoffFields.map((k, i) => [k, i])); for (const r of d.playoffs) if (!okGame(r, px)) return false; }
    for (const r of d.qbGames || []) if (!RX.gid.test(r[0]) || !RX.pid.test(r[1]) || !okNum(r[2]) || !okNum(r[3])) return false;
    for (const [k, v] of Object.entries(d.qbNames || {})) if (!RX.pid.test(k) || typeof v !== 'string' || v.length > 60) return false;
    if (d.sbSite !== undefined && !(d.sbSite && Array.isArray(d.sbSite.hosts) && d.sbSite.hosts.every(t => M.TEAMS.includes(t)) && /^[A-Za-z0-9 &'.-]{0,60}$/.test(d.sbSite.stadium || ''))) return false;
    if (d.qbOut !== undefined) {
      if (!d.qbOut || typeof d.qbOut !== 'object' || Array.isArray(d.qbOut)) return false;
      for (const [t, o] of Object.entries(d.qbOut)) if (!M.TEAMS.includes(t) || !o || !RX.pid.test(o.qb) || !['ir', 'head', 'other'].includes(o.cls) ||
        !/^[A-Za-z ]{0,20}$/.test(o.status || '') || !/^[A-Za-z /,.()-]{0,40}$/.test(o.injury || '')) return false;
    }
    return true;
  } catch (e) { return false; }
}
function validPriors(p) {
  try {
    return !!p && Object.values(p.market || {}).every(okNum) && Object.values(p.perf || {}).every(okNum) &&
      Object.entries(p.qb || {}).every(([k, v]) => RX.pid.test(k) && Array.isArray(v) && v.every(okNum)) &&
      (!p.sb || ((p.sb.hosts || []).every(t => M.TEAMS.includes(t)) && typeof (p.sb.name || '') === 'string' && /^[A-Za-z0-9 &'.-]{0,60}$/.test(p.sb.venue || '')));
  } catch (e) { return false; }
}
function validConfig(c) {
  return !!c && Number.isInteger(c.current) && (c.seasons || []).every(Number.isInteger) && (!c.sb || (c.sb.hosts || []).every(t => M.TEAMS.includes(t)));
}
let DB = null, unsubSeason = null;
function fillSeasons() {
  const yrs = [...new Set([...(CFG.seasons || []), CFG.current, YEAR])].sort((a, b) => b - a);
  $('#seasonsel').innerHTML = yrs.map(y => `<option value="${y}"${y === YEAR ? ' selected' : ''}>${y}${y === CFG.current ? '' : ' (final)'}</option>`).join('');
  $('#seasonwrap').hidden = yrs.length < 2;
}
function cleanPicks() {
  const open = new Set(season.games.filter(g => g[7] === null || g[7] === undefined).map(g => g[0]));
  for (const id of Object.keys(picks)) if (!open.has(id)) delete picks[id];
  store.set(pkey('picks'), picks);
}
function watchSeason() {
  if (unsubSeason) { unsubSeason(); unsubSeason = null; }
  if (!DB) return;
  unsubSeason = DB.doc('season/' + YEAR).onSnapshot(snap => {
    if (!snap.exists) return;
    const d = snap.data();
    if (!validSeason(d) || d.updatedAt === season.updatedAt) return;
    if (season.season === d.season && season.updatedAt && d.updatedAt < season.updatedAt) return;
    season = d; base = null; cleanPicks();
    runAll('New results arrived. Re-simulating…');
  }, () => {});
}
let loadId = 0;
async function loadSeason(y) {
  if (y === YEAR) return;
  const my = ++loadId;
  $('#runstatus').textContent = `Loading ${y}…`;
  let s = null, p = null;
  if (y === SNAPSHOT.season) { s = SNAPSHOT; p = DEFAULT_PRIORS; }
  if (DB) {
    try { const a = await DB.doc('season/' + y).get(); if (a.exists) s = a.data(); } catch (e) {}
    try { const b = await DB.doc('priors/' + y).get(); if (b.exists) p = b.data(); } catch (e) {}
  }
  if (my !== loadId) return;               // a later pick won
  if (s && !validSeason(s)) s = null;
  if (p && !validPriors(p)) p = null;
  if (!s || !p) { $('#runstatus').textContent = `Couldn't load the ${y} season.`; fillSeasons(); return; }
  YEAR = y; season = s; PRI = p; base = null; HIST = null;
  picks = store.get(pkey('picks'), {}); qbPicks = store.get(pkey('qbpicks'), {}); week = null;
  cleanPicks(); fillSeasons(); watchSeason();
  runAll();
}
$('#seasonsel').addEventListener('change', e => loadSeason(+e.target.value));

focus = hashTeam() || (M.TEAMS.includes(store.get('nfl26.focus', '')) ? store.get('nfl26.focus', '') : '');
fillTeams();
fillSeasons();
cleanPicks();
runAll();

(async () => {
  try { DB = await claude.use('db'); } catch (e) { DB = null; }
  if (!DB) return;
  watchSeason();
  let first = true;
  DB.doc('config/current').onSnapshot(async snap => {
    if (!snap.exists) return;
    const c = snap.data(); if (!validConfig(c)) return;
    const moved = c.current !== CFG.current;
    CFG = c; fillSeasons();
    if (first || moved) {
      first = false;
      if (c.current !== YEAR) { await loadSeason(c.current); return; }
      const yr = YEAR;
      try { const b = await DB.doc('priors/' + yr).get(); if (b.exists && YEAR === yr && validPriors(b.data())) { PRI = b.data(); base = null; runAll(); } } catch (e) {}
    }
  }, () => {});
})();

})();
