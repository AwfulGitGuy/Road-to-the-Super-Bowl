"""Keep data/super_bowl_hosts.json filled in from Wikipedia, which has a page for each future Super Bowl
once its site is awarded (e.g. "Super Bowl LXV").

Run by the yearly new-season job (and by hand:  python scripts/sb_sites.py). It never overwrites an entry:
it only adds seasons that are missing, and records what it checked under "_lastCheck". Any problem
(no network, page missing, unexpected page layout) just means nothing is added.
"""
import json, os, re, sys, urllib.parse, urllib.request
DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
AHEAD = 6            # look this many seasons ahead
UA = 'road-to-the-super-bowl/1.0 (https://github.com/AwfulGitGuy/Road-to-the-Super-Bowl)'

def roman(n):
    out = ''
    for v, s in ((1000, 'M'), (900, 'CM'), (500, 'D'), (400, 'CD'), (100, 'C'), (90, 'XC'), (50, 'L'), (40, 'XL'), (10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')):
        while n >= v: out += s; n -= v
    return out

def fetch_wikitext(title):
    url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode({'action': 'parse', 'page': title, 'prop': 'wikitext', 'format': 'json', 'formatversion': 2, 'redirects': 1})
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=30) as r:
        d = json.load(r)
    return None if 'error' in d else d.get('parse', {}).get('wikitext')

def clean(v):
    v = re.sub(r'<ref[^>]*/>|<ref[^>]*>.*?</ref>', '', v, flags=re.S)
    v = re.sub(r'<!--.*?-->', '', v, flags=re.S)
    v = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', r'\1', v)            # [[target|label]] -> label
    for _ in range(3): v = re.sub(r'\{\{(?:[^{}|]*\|)?([^{}]*)\}\}', r'\1', v)   # {{nowrap|x}} -> x
    v = re.sub(r'<[^>]+>', ' ', v)
    return re.sub(r'\s+', ' ', v).strip(" ,;'")

def stadium_of(wikitext):
    m = re.search(r'^\s*\|\s*stadium\s*=\s*(.+)$', wikitext or '', flags=re.M | re.I)
    if not m: return None
    s = clean(m.group(1))
    if not s or re.search(r'\bTB[AD]\b|to be (announced|determined)|\?', s, flags=re.I): return None
    return s[:60]

norm = lambda s: re.sub(r'[^a-z0-9]', '', re.sub(r'^new\s+', '', (s or '').lower()))

def home_stadiums():
    """Stadium name -> team codes, from this season's schedule (home games only)."""
    cfg = json.load(open(os.path.join(DATA, 'config.json')))
    out = {}
    for yr in (cfg['current'], cfg['current'] - 1):
        p = os.path.join(DATA, f'season-{yr}.json')
        if not os.path.exists(p): continue
        d = json.load(open(p)); d = d.get('data', d); ix = {k: i for i, k in enumerate(d['fields'])}
        if 'stadium' not in ix: continue
        for r in d['games']:
            if not r[ix['neutral']] and r[ix['stadium']]: out.setdefault(norm(r[ix['stadium']]), set()).add(r[ix['home']])
    return out

def hosts_for(stadium, homes):
    n = norm(stadium)
    for k, teams in homes.items():
        if k and (k == n or k in n or n in k): return sorted(teams)
    return []

def update(fetch=fetch_wikitext, today_season=None):
    path = os.path.join(DATA, 'super_bowl_hosts.json')
    hosts = json.load(open(path))
    cfg = json.load(open(os.path.join(DATA, 'config.json')))
    first = today_season or cfg['current']
    homes = home_stadiums()
    check = {'source': 'Wikipedia', 'agrees': [], 'differs': [], 'added': [], 'notYetAwarded': []}
    for season in range(first, first + AHEAD):
        name = f'Super Bowl {roman(season - 1965)}'
        try: st = stadium_of(fetch(name.replace(' ', '_')))
        except Exception as e: print(f'NOTE: could not check {name} ({e}).'); continue
        key, have = str(season), hosts.get(str(season))
        if not st: check['notYetAwarded'].append(key); continue
        if have:
            (check['agrees'] if norm(have.get('venue')) == norm(st) or norm(have.get('venue')) in norm(st) or norm(st) in norm(have.get('venue')) else check['differs']).append(key)
            if key in check['differs']: print(f'NOTE: {name}: list says {have.get("venue")!r}, Wikipedia says {st!r}. Leaving the list as is.')
            continue
        hosts[key] = {'name': name, 'venue': st, 'hosts': hosts_for(st, homes)}
        check['added'].append(key); print(f'Added {name} ({season} season): {st}, hosts {hosts[key]["hosts"] or "none (neutral)"}')
    hosts['_lastCheck'] = check
    keys = sorted((k for k in hosts if k.isdigit()), key=int)
    ordered = {k: hosts[k] for k in ('_note',) if k in hosts} | {k: hosts[k] for k in keys} | {'_lastCheck': check}
    text = '{\n' + ',\n'.join(f'  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}' for k, v in ordered.items()) + '\n}\n'
    if text != open(path).read(): open(path, 'w').write(text)
    return check

if __name__ == '__main__':
    print('Super Bowl sites:', json.dumps(update()))
