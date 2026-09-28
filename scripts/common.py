"""Shared helpers for update.py and new_season.py."""
import json, os, shutil, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
SCRIPTS = os.path.join(ROOT, 'scripts')
GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
STATS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{year}.csv'


def download(url, dest, required=True, tries=3):
    """Download url to dest. Returns True on success. A 404 on an optional file writes an empty file."""
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r, open(dest, 'wb') as f:
                shutil.copyfileobj(r, f)
            return True
        except urllib.error.HTTPError as e:
            if e.code == 404 and not required:
                open(dest, 'w').close()
                return False
            err = e
        except Exception as e:  # network hiccup: retry
            err = e
        time.sleep(5 * (attempt + 1))
    print(f'Download failed: {url} ({err})')
    sys.exit(1)


def run(script, args, cwd):
    """Run one of the scripts in scripts/ and return its output; stop if it fails."""
    p = subprocess.run([sys.executable, os.path.join(SCRIPTS, script)] + [str(a) for a in args],
                       cwd=cwd, capture_output=True, text=True)
    print(p.stdout.strip())
    if p.returncode != 0:
        print(p.stderr.strip())
        sys.exit(p.returncode)
    return p.stdout


def load(name):
    return json.load(open(os.path.join(DATA, name)))


def workdir():
    return tempfile.mkdtemp(prefix='nflsim-')
