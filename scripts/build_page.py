"""Assemble index.html from the source files in src/ and the data in data/.

Run from anywhere:  python scripts/build_page.py
The page embeds a snapshot of the current season (used only if the data files can't be read).
"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, DATA = os.path.join(ROOT, 'src'), os.path.join(ROOT, 'data')
read = lambda *p: open(os.path.join(*p), encoding='utf-8').read()
head, body, model, app, perf, pc = (read(SRC, f) for f in ('page_head.html', 'page_body.html', 'model.js', 'app.js', 'perf.js', 'perf_const.json'))
cfg = read(DATA, 'config.json'); year = json.loads(cfg)['current']
season, pri = read(DATA, f'season-{year}.json'), read(DATA, f'priors-{year}.json')
shim = """
// Reads the data files published next to this page (data/*.json) in place of a database.
const FileDB = {
  doc(path) {
    const [col, id] = path.split('/');
    const url = col === 'config' ? 'data/config.json' : `data/${col}-${id}.json`;
    const get = async () => {
      try {
        const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) return { exists: false, data: () => undefined };
        const d = await r.json(); return { exists: true, data: () => d };
      } catch (e) { return { exists: false, data: () => undefined }; }
    };
    // Check for new data every 5 minutes, and right away when the visitor comes back to the tab.
    return { get, onSnapshot(next) {
      let last = 0; const run = () => { last = Date.now(); get().then(next); };
      run(); const t = setInterval(run, 5 * 60 * 1000);
      const vis = () => { if (document.visibilityState === 'visible' && Date.now() - last > 60 * 1000) run(); };
      document.addEventListener('visibilitychange', vis);
      return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
    } };
  },
};
"""
app = app.replace("try { DB = await claude.use('db'); } catch (e) { DB = null; }", "DB = FileDB;", 1)
app = app.replace("let DB = null, unsubSeason = null;", shim + "let DB = null, unsubSeason = null;", 1)
assert 'FileDB' in app and 'claude.use' not in app
base = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}img{max-width:100%}[hidden]{display:none!important}</style>
"""
html = (base + head + "\n</head>\n<body>\n" + body
        + '<script type="text/plain" id="model-src">' + model + '</script>\n<script>' + model + '</script>\n'
        + '<script>const SNAPSHOT=' + season + ';\nconst DEFAULT_PRIORS=' + pri + ';\nconst DEFAULT_CONFIG=' + cfg + ';</script>\n'
        + '<script>' + perf + '\nconst PERF_CONST=' + pc + ';</script>\n<script>' + app + '</script>\n</body>\n</html>\n')
open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8').write(html)
print('Built index.html', len(html), 'bytes')
