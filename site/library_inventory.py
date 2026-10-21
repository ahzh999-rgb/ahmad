"""Read-only discovery catalog. Listed sources never become answer-eligible here."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlparse
from html.parser import HTMLParser

ISSUE_RE = re.compile(r'(?:uqn|gazette|umm-al-qura)[-_]?(\d{4})(?!\d|-\d{2}-\d{2})', re.I)
ASSET_EXTENSIONS = {'.pdf', '.png', '.jpg', '.jpeg', '.webp'}
DECISION_TITLE = re.compile(r'^(?:قرار|مرسوم|أمر|تعديل قرار)')


class ArticleText(HTMLParser):
    """Extract only the archived publisher's article container, never navigation or executable HTML."""
    BLOCKS = {'p','div','section','article','li','ul','ol','h1','h2','h3','h4','h5','h6','tr','blockquote'}
    IGNORE = {'script','style','noscript','template','iframe','object','svg'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = None; self.depth = 0; self.matches = 0; self.ignored = []; self.parts = []

    def handle_starttag(self, tag, attrs):
        if dict(attrs).get('id') == 'article-content':
            self.matches += 1
            if not self.depth and tag in {'div','article','section','main'}:
                self.root = tag; self.depth = 1
                return
        if not self.depth:
            return
        if tag == self.root:
            self.depth += 1
        if tag in self.IGNORE:
            self.ignored.append(tag)
        if not self.ignored and (tag in self.BLOCKS or tag == 'br'):
            self.parts.append('\n')
        elif not self.ignored and tag in {'td','th'}:
            self.parts.append(' | ')

    def handle_endtag(self, tag):
        if not self.depth:
            return
        if self.ignored:
            if tag == self.ignored[-1]:
                self.ignored.pop()
        elif tag in self.BLOCKS:
            self.parts.append('\n')
        if tag == self.root:
            self.depth -= 1

    def handle_data(self, data):
        if self.depth and not self.ignored:
            self.parts.append(data)

    def text(self):
        if self.matches != 1 or self.depth:
            return None
        lines = [re.sub(r'[\t\r\f\v ]+', ' ', line).strip() for line in ''.join(self.parts).split('\n')]
        return '\n'.join(line for line in lines if line) or None


def source_reading(path):
    """Plain reading copy only: source bytes and answer eligibility remain unchanged."""
    if path.suffix.lower() not in {'.html','.txt','.md'}:
        return None
    raw = path.read_bytes()
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        return None
    if path.suffix.lower() == '.html':
        parser = ArticleText(); parser.feed(text); parser.close(); text = parser.text()
    if not text or not text.strip():
        return None
    return {'format':'plain_text', 'text':text, 'sha256':hashlib.sha256(text.encode()).hexdigest(),
            'source_sha256':hashlib.sha256(raw).hexdigest(),
            'extraction':'html_article_content_v1' if path.suffix.lower() == '.html' else 'utf8_source_v1',
            'answer_eligibility_changed':False}


def safe_path(root, value):
    if not isinstance(value, str) or not value or '\\' in value:
        return None
    path = (root/value).resolve()
    return path if path.is_relative_to(root) and path.is_file() else None


def walk(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)


def source_paths(value):
    if isinstance(value, str):
        if value.startswith('sources/'):
            yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from source_paths(item)
    elif isinstance(value, list):
        for item in value:
            yield from source_paths(item)


def https(value):
    return value if isinstance(value, str) and urlparse(value).scheme == 'https' and urlparse(value).hostname else None


def build_inventory(root, records, docs, snapshot):
    root = Path(root).resolve()
    tracked = subprocess.check_output(['git', '-C', str(root), 'ls-files', 'sources'], text=True).splitlines()
    assets = [p for p in tracked if Path(p).suffix.lower() in ASSET_EXTENSIONS]
    issue_files = {}
    for path in assets:
        match = ISSUE_RE.search(path)
        if match:
            issue_files.setdefault(match[1], {})[path] = {'basis': 'archive_path', 'evidence_path': path}
    # Publication records can identify issues absent from a filename (e.g. M/5).
    evidence_files = subprocess.check_output(['git', '-C', str(root), 'ls-files', 'analysis', 'legislation'], text=True).splitlines()
    for evidence in evidence_files:
        if not evidence.endswith('.json'):
            continue
        path = root/evidence
        try:
            obj = json.loads(path.read_text())
        except (ValueError, UnicodeError):
            continue
        for item in walk(obj):
            number = next((str(item[k]) for k in ('gazette_issue', 'gazette_number', 'issue_number')
                           if re.fullmatch(r'\d{4}', str(item.get(k, '')))), None)
            source = item.get('source_path')
            if number and source in assets and re.search(r'uqn|gazette|umm-al-qura', source, re.I):
                issue_files.setdefault(number, {})[source] = {
                    'basis': 'recorded_publication_relation', 'evidence_path': evidence}
    eligible = {d['id']: len(d['secs']) for d in docs}
    registry_path = root/'indexes/file_registry.json'
    registry = json.loads(registry_path.read_text())
    file_to_documents = {}
    for doc in registry['documents']:
        for files in doc['formats'].values():
            for path in files:
                file_to_documents.setdefault(path, set()).add(doc['id'])
    # Also retain explicit metadata associations to publication witnesses.
    for ident, record in records.items():
        for path in source_paths(record['data']):
            file_to_documents.setdefault(path, set()).add(ident)
    # Explicit per-document evidence files can link an issue to an amendment
    # witness, even when the main metadata only links the review register.
    for ident, record in records.items():
        folder = str(Path(record['metadata']).parent)+'/' if record.get('metadata') else None
        for evidence in evidence_files:
            if not folder or not evidence.startswith(folder) or not evidence.endswith('.json'):
                continue
            try:
                evidence_data = json.loads((root/evidence).read_text())
            except (ValueError, UnicodeError):
                continue
            for path in source_paths(evidence_data):
                file_to_documents.setdefault(path, set()).add(ident)
        for path in source_paths(record['verification']):
            file_to_documents.setdefault(path, set()).add(ident)
    digest_cache = {}

    def file_record(path, relation=None):
        file = safe_path(root, path)
        if not file:
            return None
        if path not in digest_cache:
            digest_cache[path] = hashlib.sha256(file.read_bytes()).hexdigest()
        result = dict(path=path, sha256=digest_cache[path], format=file.suffix[1:].lower(), **(relation or {}))
        reading = source_reading(file)
        if reading:
            result['reading'] = reading
        return result

    decisions = []
    for ident, record in records.items():
        if not DECISION_TITLE.search(record['title']):
            continue
        meta = record['data'];dims = record['verification']['dimensions']
        instrument = meta.get('instrument') or {}
        source = file_record(meta.get('source_path', ''))
        number = instrument.get('number') or meta.get('instrument_number') or meta.get('decision_number')
        date = instrument.get('issue_date_hijri') or meta.get('issue_date_hijri')
        number_basis = 'metadata' if number else None
        if not number:
            match = re.search(r'م/\d+', record['title']) if record['title'].startswith('مرسوم') else re.search(r'(?<!\d)(\d{3,6})(?=\s|$)', record['title'])
            if match:
                number = match.group(0)
                number_basis = 'title_transcription'
        decisions.append(dict(id=ident, title=record['title'],
            kind='مرسوم' if record['title'].startswith('مرسوم') else 'قرار أو تعديل قرار',
            number=str(number) if number is not None else None, number_basis=number_basis, issue_date_hijri=date,
            metadata_path=record['metadata'] or record['index'],
            sources=[source] if source else [], official_url=https(meta.get('official_source_url')),
            verification={k:{key:v for key,v in dims.get(k, {}).items() if key in ('status','scope','as_of','evidence')}
                          for k in ('issuance','publication','effectiveness','official_match','owner_approval')},
            eligible_article_count=eligible.get(ident, 0), answer_eligibility_changed=False))
    issues = []
    for number, files in sorted(issue_files.items(), key=lambda x:int(x[0]), reverse=True):
        sources = [file_record(path, relation) for path, relation in sorted(files.items())]
        sources = [s for s in sources if s]
        if not sources:
            continue
        # A PDF without a page/extract label is a candidate issue file, NOT proof of completeness.
        pdf = any(s['format']=='pdf' and not re.search(r'extract|pages?\d|page[-_]\d', s['path'], re.I) for s in sources)
        related_set = {i for path in files for i in file_to_documents.get(path, set()) if i in records}
        for ident, record in records.items():
            publication = record['data'].get('publication')
            if isinstance(publication, dict) and str(publication.get('issue_number')) == number:
                related_set.add(ident)
        related = sorted(related_set)
        issues.append(dict(id=number, title='أم القرى · العدد '+number, issue_number=number,
            archive_kind='ISSUE_PDF_COMPLETENESS_UNVERIFIED' if pdf else 'PAGES_OR_WITNESSES',
            full_issue_verified=False, all_contents_indexed=False, sources=sources,
            related_documents=[dict(id=i, title=records[i]['title'], metadata_path=records[i]['metadata'] or records[i]['index'], relation_scope='linked_archive_witness_not_exhaustive_issue_contents', eligible_article_count=eligible.get(i,0)) for i in related]))
    return dict(schema_version=1, repository='ahzh999-rgb/saudi-legislation', snapshot=snapshot,
        coverage='archived_decision_records_and_identifiable_gazette_witnesses; not_all_decisions_or_issues',
        answer_eligibility_changed=False, decisions=decisions, gazette_issues=issues)
