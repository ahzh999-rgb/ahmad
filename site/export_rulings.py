"""Build the judicial rulings library assets from a clean, pinned saudi-legislation checkout.

    python site/export_rulings.py /path/to/saudi-legislation [--check | --update-lock]

Reads indexes/rulings.json and the per-ruling records and texts at the commit in
site/rulings-lock.json, verifies every recorded SHA-256, and writes:
  site/public/rulings/catalog.json   records without the full text (browse and search)
  site/public/rulings/text/<id>.txt  machine-read text, fetched only when a ruling is opened
  site/public/rulings/manifest.json  commit, counts and SHA-256 of every file above

Rulings are browse-only. Nothing here touches data.json, source-manifest.json or the
answer path; a ruling never becomes evidence for /api/ask.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

REPOSITORY = 'ahzh999-rgb/saudi-legislation'
SITE = Path(__file__).resolve().parent
LOCK = SITE / 'rulings-lock.json'
OUT = SITE / 'public' / 'rulings'
RECORD_FIELDS = ('id', 'jurisdiction', 'authority', 'collection', 'volume', 'topic', 'seq', 'case', 'keywords', 'principle',
                 'effect', 'provisions', 'ruling', 'appeal_ruling', 'outcome', 'notes')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_text(x):
    return json.dumps(x, ensure_ascii=False, separators=(',', ':')) + '\n'


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()


def build(root):
    root = Path(root)
    index = json.loads((root / 'indexes' / 'rulings.json').read_text(encoding='utf-8'))
    collections = {c['id']: c for c in index['collections']}
    rulings, texts = [], {}
    for item in index['rulings']:
        rec = json.loads((root / item['record']).read_text(encoding='utf-8'))
        raw = (root / rec['text']['path']).read_bytes()
        if sha(raw) != rec['text']['sha256'] or rec['text']['sha256'] != item['text_sha256']:
            sys.exit(f'text hash differs for {rec["id"]}')
        src = root / rec['source']['path']
        if sha(src.read_bytes()) != rec['source']['sha256']:
            sys.exit(f'source hash differs for {rec["id"]}')
        if rec['verification']['eligible_for_answers']:
            sys.exit(f'{rec["id"]} is marked eligible for answers; the site keeps rulings browse-only')
        entry = {k: rec[k] for k in RECORD_FIELDS}
        entry.update(official_url=rec['source']['official_url'], source_path=rec['source']['path'], source_sha256=rec['source']['sha256'],
                     pages=rec['source']['pages'], full_volume_page_start=rec['source']['full_volume_page_start'],
                     text_sha256=rec['text']['sha256'], verification=rec['verification']['status'],
                     collection_title=collections[rec['collection']]['title'])
        rulings.append(entry)
        texts[rec['id']] = raw
    catalog = {'schema_version': 1, 'jurisdictions': index['jurisdictions'], 'collections': index['collections'],
               'rulings': sorted(rulings, key=lambda r: r['id'])}
    return catalog, texts


def render(catalog, texts, commit):
    files = {'catalog.json': json_text(catalog).encode()}
    for rid, raw in texts.items():
        files[f'text/{rid}.txt'] = raw
    manifest = {'schema_version': 1, 'repository': REPOSITORY, 'commit': commit, 'ruling_count': len(catalog['rulings']),
                'browse_only': True, 'verification': 'MACHINE_READ',
                'files': {name: sha(data) for name, data in sorted(files.items())}}
    files['manifest.json'] = json_text(manifest).encode()
    return files


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('source')
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--update-lock', action='store_true')
    a = ap.parse_args(argv)
    root = Path(a.source)
    if git(root, 'status', '--porcelain'):
        sys.exit('source checkout is not clean')
    commit = git(root, 'rev-parse', 'HEAD')
    lock = json.loads(LOCK.read_text(encoding='utf-8')) if LOCK.exists() else {}
    if a.update_lock:
        lock = {'repository': REPOSITORY, 'commit': commit, 'schema_version': 1}
        LOCK.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if lock.get('commit') != commit:
        sys.exit(f'source commit {commit} differs from site/rulings-lock.json')
    files = render(*build(root), commit)
    if a.check:
        stale = [n for n, d in files.items() if not (OUT / n).is_file() or (OUT / n).read_bytes() != d]
        extra = [p.relative_to(OUT).as_posix() for p in OUT.rglob('*') if p.is_file() and p.relative_to(OUT).as_posix() not in files]
        if stale or extra:
            sys.exit(f'rulings assets are stale: {len(stale)} changed, {len(extra)} unexpected')
        print(f'rulings assets match {commit[:12]} ({len(files) - 2} rulings)')
        return
    if OUT.exists():
        shutil.rmtree(OUT)
    for name, data in files.items():
        (OUT / name).parent.mkdir(parents=True, exist_ok=True)
        (OUT / name).write_bytes(data)
    print(f'wrote {len(files)} files for {commit[:12]}')


if __name__ == '__main__':
    main()
