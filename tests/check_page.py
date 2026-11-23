"""Check that index.html is up to date with src/: rebuild it to a temporary file and compare, ignoring the
embedded data snapshot lines (they change with every data refresh). Run: python3 tests/check_page.py"""
import os, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(tempfile.mkdtemp(), 'index.html')
subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'build_page.py'), out], check=True, capture_output=True)
strip = lambda t: [l for l in t.splitlines() if not l.startswith(('<script>const SNAPSHOT=', 'const DEFAULT_PRIORS=', 'const DEFAULT_CONFIG='))]
a, b = strip(open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()), strip(open(out, encoding='utf-8').read())
if a != b:
    diff = next(i for i, (x, y) in enumerate(zip(a + [''], b + [''])) if x != y)
    sys.exit(f'index.html is out of date with src/ (first difference at line {diff + 1}). Run: python scripts/build_page.py')
print('index.html matches src/')
