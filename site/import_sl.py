"""ينقل النصوص الرسمية من مستودع saudi-legislation إلى مكتبة التشريعات بالصيغة الموثقة.

الاستخدام: python3 import_sl.py <مسار saudi-legislation> <مسار مكتبة-التشريعات>

- يأخذ فقط النصوص المنقولة من صفحات المصادر الرسمية (OFFICIAL_TEXT.md) ونظام 1448 من articles.json.
  أما EXTRACTED_TEXT.md (نص مستخرج آلياً من PDF) فلا يؤخذ: ترتيب الحروف والأرقام فيه مضطرب.
- يكتب كل وثيقة في مجلد: <المجال>/<اسم الوثيقة>/full_text.md + metadata.json
- يحذف النسخة القديمة المحوّلة آلياً من المكتبة حين تحل محلها نسخة رسمية (قائمة REPLACES).
- يعيد كتابة مجلدات الاستيراد السابقة كلها، فيمكن تشغيله بعد كل تحديث للمستودع.
"""
import os, re, json, sys, shutil, glob

from build_data import ordinal

SL, LIB = sys.argv[1], sys.argv[2]
TODAY = '2026-10-12'
MARK = 'imported_from'  # يميز مجلدات الاستيراد في metadata.json

# المجال في المكتبة حسب مجلد المصدر
def domain(rel):
    name = rel.split('/')[-1]
    if rel.startswith('legislation/human-resources/'): return '06-الموارد-البشرية'
    if name.startswith('administrative-execution'): return '08-القضائية'
    if name.startswith('state-property'): return '03-المالية-العامة'
    if name == 'executive-1441': return '04-المنافسات'
    return '04-المنافسات'

# ما يحل محل ملف قديم في المكتبة
REPLACES = {
    'SA-LAW-GTP-1448-001': '04-المنافسات/نظام-المنافسات-والمشتريات-الحكومية-1448.md',
    'conflicts-of-interest': '04-المنافسات/لائحة-تعارض-المصالح-في-المنافسات-537.md',
    'procurement-ethics': '04-المنافسات/لائحة-سلوكيات-القائمين-على-المنافسات-537.md',
    'discipline-law': '06-الموارد-البشرية/نظام-الانضباط-الوظيفي-م18-1443.md',
    'discipline-executive': '06-الموارد-البشرية/اللائحة-التنفيذية-لنظام-الانضباط-الوظيفي.md',
    'social-insurance-1445': '06-الموارد-البشرية/نظام-التأمينات-الاجتماعية-م273.md',
    'privatization-law': '04-المنافسات/نظام-التخصيص-م63.md',
    'administrative-execution-law': '08-القضائية/نظام-التنفيذ-أمام-ديوان-المظالم-م15.md',
    'SA-LAW-GTP-1440-001': '04-المنافسات/نظام-المنافسات-والمشتريات-الحكومية-م128-1440',
    'executive-1441': '04-المنافسات/اللائحة-التنفيذية-لنظام-المنافسات-والمشتريات-الحكومية-معدلة-3479-1441',
    'civil-service': '06-الموارد-البشرية/نظام-الخدمة-المدنية-م49.md',
    'financial-rights': '06-الموارد-البشرية/لائحة-الحقوق-والمزايا-المالية-أ28.md',
    'hr-executive': '06-الموارد-البشرية/اللائحة-التنفيذية-للموارد-البشرية-1550-محدثة.md',
}
# موجودة في المكتبة بنص وثّقه صاحب المشروع، فلا تُستورد
SKIP = {'privatization-executive'}  # حلت محلها نسخة 2024 المعدلة

# مصدر النص لوثائق ليس نصها في OFFICIAL_TEXT.md
TEXT_FILE = {'executive-1441': 'CONSOLIDATED_RESEARCH_DRAFT.md',
             'privatization-organizing-rules': 'VISUALLY_REVIEWED_TEXT.md',
             'public-money-base-law': 'ORIGINAL_VISUALLY_REVIEWED_TEXT.md'}
# النص من OFFICIAL_TEXT.md (المصحح)، وعناوين الأبواب والفصول من نسخة النقل الأصلية، فهي تساعد البحث
CHAPTERS_FROM = {'SA-LAW-GTP-1440-001': 'full_text.md'}

# تصحيحات جوهرية اعتمدها صاحب المشروع (مسجلة في VERIFICATION_DOSSIER.json لكل وثيقة)؛ تُطبَّق على العرض فقط ولا يُعدَّل بها المستودع المصدر
CORRECTIONS = {'privatization-law': [('أكثر من (05%) من رأس مالها', 'أكثر من (50%) من رأس مالها'),
                                      ('وانفاذ ما يلزم من إجراءات', 'واتخاذ ما يلزم من إجراءات')]}

FIX = str.maketrans({'ی': 'ي', 'ھ': 'ه', 'ک': 'ك', 'ە': 'ه'})
ART = re.compile(r'^(?:#{1,6}\s*)?(?:\*\*)?\s*(?:ال)?مادة\s*(\(\s*\d+\s*\)|\d+|\(?ال[^:：*()]*?\)?)\s*(?:\*\*)?\s*(?:[:：]\s*(?:\*\*)?\s*(.*))?$')
# «المادة 15 مكرر» مادة مستقلة
BIS = re.compile(r'^(?:#{1,6}\s*)?(?:\*\*)?\s*(?:ال)?مادة\s*\(?\s*(\d+)\s*\)?\s*مكرر\s*\(?\s*(\d*)\s*\)?\s*(?:\*\*)?\s*(?:[:：]\s*(?:\*\*)?\s*(.*))?$')
ANNEX = re.compile(r'^#+\s*(?:ال)?(?:ملحق|ملاحق|العقد الموحد|نموذج)')
NOISE = re.compile(r'^(صفحات? PDF:|المصدر: صفحات ?PDF|حالة النص:|المصدر: PDF صفحة|\[?!?\[?(Shrink|Enlarge) Font|\[(PDF|المصدر الرسمي)\b|>)')


def art_no(tok):
    tok = tok.strip()
    m = re.fullmatch(r'\(?\s*(\d+)\s*\)?', tok)
    if m: return int(m.group(1))
    return ordinal(tok.strip('() '))


def normalize(txt, title):
    """يوحد العناوين: «#### المادة N:» لكل مادة، ويحذف ملاحظات النقل وبقايا الصفحات."""
    out = [f'# {title}', '']
    lines = [l.strip() for l in txt.translate(FIX).split('\n')]
    # عنوان باب أو فصل بخط عريض، وعنوانه في سطر بعده: «**الفصل الثاني: **» ثم «**الضمان الابتدائي**»
    for i, l in enumerate(lines):
        m = re.fullmatch(r'\*\*\s*((?:الباب|الفصل)\s+[^*:：]{2,30}?)\s*[:：]?\s*\*\*', l)
        if not m: continue
        j = i + 1
        while j < len(lines) and not lines[j]: j += 1
        t = re.fullmatch(r'\*\*\s*([^*]{2,60}?)\s*\*\*', lines[j]) if j < len(lines) else None
        if t and not ART.match(t.group(1)) and not re.match(r'(?:الباب|الفصل)\s', t.group(1)):
            lines[i], lines[j] = f'{m.group(1)}: {t.group(1)}', ''
    # عنوان مادة مقسوم على سطرين في المصدر: «المادة» ثم «الرابعة:»، أو «المادة الثالثة» ثم «عشرة:»
    for i in range(len(lines) - 1):
        if re.fullmatch(r'(?:ال)?مادة(?:\s+\S+)?', lines[i]) and re.fullmatch(r'[^\s:：]+(?:\s+[^\s:：]+)?\s*[:：]\s*', lines[i + 1]):
            joined = lines[i] + ' ' + lines[i + 1]
            mm = ART.match(joined)
            if mm and art_no(mm.group(1)):
                lines[i], lines[i + 1] = joined, ''
    for i in range(len(lines) - 1):
        if re.fullmatch(r'(?:الباب|الفصل)\s+[^:：]{2,40}[:：]?', lines[i]) and 0 < len(lines[i + 1]) < 60 \
                and not ART.match(lines[i + 1]) and not re.match(r'(?:الباب|الفصل)\s', lines[i + 1]):
            lines[i], lines[i + 1] = lines[i].rstrip(':：') + ': ' + lines[i + 1], ''
    annex = False  # بعد عنوان ملحق أو نموذج: «مادة (1)» غير المعنونة بند في العقد، لا مادة في اللائحة
    for s in lines:
        if s.startswith('# ') and not out[2:]: continue  # عنوان الملف الأصلي
        if NOISE.match(s): continue
        if s.startswith('#'): annex = bool(ANNEX.match(s)) or (annex and not ART.match(s))
        if annex and not s.startswith('#') and ART.match(s):
            out.append('**' + s + '**')
            continue
        b = BIS.match(s)
        if b:
            out += ['', f"#### المادة {b.group(1)} مكرر{' ' + b.group(2) if b.group(2) else ''}:"]
            if b.group(3): out.append(b.group(3).strip())
            continue
        m = ART.match(s)
        if m:
            n = art_no(m.group(1))
            rest = (m.group(2) or '').strip()
            # عنوان مادة: رقم صحيح، والسطر عنوان وحده أو بعده نقطتان
            if n:
                out += ['', f'#### المادة {n} ({m.group(1).strip("() ")}):'] if not re.fullmatch(r'\(?\s*\d+\s*\)?', m.group(1).strip()) \
                    else ['', f'#### المادة {n}:']
                if rest: out.append(rest)
                continue
        if s.startswith('#') or re.match(r'(?:الباب|الفصل)\s+\S+[^:：]{0,30}[:：]\s*\S', s) and len(s) < 90:
            out += ['', '## ' + s.lstrip('#').strip()]
            continue
        out.append(s)
    t = '\n'.join(out)
    return re.sub(r'\n{3,}', '\n\n', t).strip() + '\n'


def add_chapters(body, src):
    """ينقل عناوين «## الباب/الفصل» من نص src إلى body قبل المادة نفسها."""
    heads, cur = {}, []
    for l in src.split('\n'):
        if l.startswith('## '): cur.append(l)
        m = re.match(r'#### المادة (\d+)', l)
        if m:
            if cur: heads[m.group(1)] = cur
            cur = []
    out = []
    for l in body.split('\n'):
        m = re.match(r'#### المادة (\d+)', l)
        if m and m.group(1) in heads: out += heads[m.group(1)] + ['']
        out.append(l)
    return '\n'.join(out)


def slug(title):
    s = re.sub(r'[^\w؀-ۿ]+', '-', title).strip('-')
    return s[:90].rstrip('-')


def meta_for(rel, m, n_arts):
    approved = m.get('legal_approval') is True
    # المقروء بصرياً مادة مادة من صورة الأصل يعد موثقاً
    wfw = m.get('word_for_word_verified') is True or bool(m.get('original_articles_visually_reviewed'))
    ls = m.get('legal_status')
    status = ls.get('status') if isinstance(ls, dict) else ls
    ins = m.get('instrument') if isinstance(m.get('instrument'), dict) else {}
    url = m.get('official_source_url') or (m.get('publication') or {}).get('source_url') or ''
    return {
        'id': 'SL-' + m.get('id', rel.split('/')[-1]),
        'title': m.get('title', ''),
        'jurisdiction': 'SA',
        'language': 'ar',
        'instrument': {
            'type': ins.get('type', ''),
            'number': ins.get('number', ''),
            'issue_date_hijri': ins.get('issue_date_hijri') or (m.get('publication') or {}).get('publication_date_hijri', ''),
        },
        'legal_status': {
            'status': status or '',
            'is_verified': approved or wfw,
            'owner_approved': approved,
        },
        'source': {
            'type': 'official',
            'url': url,
            'text_verified': approved or wfw,
            'verification_method': 'owner_approval' if approved else ('visual_match_original' if wfw else 'official_page_transcription'),
        },
        'repository_notes': {
            MARK: 'ahzh999-rgb/saudi-legislation/' + rel,
            'article_headings': n_arts,
            'notes': m.get('notes', []),
        },
        'maintenance': {'added_at': TODAY, 'updated_at': TODAY},
    }


# احذف مجلدات الاستيراد السابقة
for mp in glob.glob(os.path.join(LIB, '*', '*', 'metadata.json')):
    try:
        if MARK in json.load(open(mp, encoding='utf-8')).get('repository_notes', {}):
            shutil.rmtree(os.path.dirname(mp))
    except Exception:
        pass

done, skipped = [], []
for mp in sorted(glob.glob(os.path.join(SL, 'legislation', '**', 'metadata.json'), recursive=True)):
    d = os.path.dirname(mp); rel = os.path.relpath(d, SL)
    key = rel.split('/')[-1]
    m = json.load(open(mp, encoding='utf-8'))
    if key in SKIP: skipped.append((key, 'موثق في المكتبة')); continue
    title = (m.get('title') or key).split(' — ')[0].strip()
    title = re.sub(r'([\u0621-\u064A])(\d)', r'\1 \2', title)  # «الاجتماعية1445هـ» ← «الاجتماعية 1445هـ»
    ap = os.path.join(d, 'articles.json'); op = os.path.join(d, TEXT_FILE.get(key, 'OFFICIAL_TEXT.md'))
    if os.path.exists(ap) and not os.path.exists(op):
        ft = os.path.join(d, 'full_text.md')
        arts = json.load(open(ap, encoding='utf-8'))['articles']
        raw = '\n\n'.join(f"{a['heading'] if a['heading'].endswith(':') else a['heading'] + ':'}\n{a['text']}" for a in arts)
        # النص الكامل يحفظ عناوين الأبواب والفصول؛ يُستعمل إذا اكتملت فيه المواد
        if os.path.exists(ft):
            alt = open(ft, encoding='utf-8').read()
            if len(re.findall(r'(?m)^#### المادة', normalize(alt, title))) == len(arts): raw = alt
    elif os.path.exists(op):
        raw = open(op, encoding='utf-8').read()
    else:
        skipped.append((key, 'نص مستخرج آلياً فقط')); continue
    for old_s, new_s in CORRECTIONS.get(key, []):
        assert raw.count(old_s) == 1, (key, old_s)
        raw = raw.replace(old_s, new_s)
    body = normalize(raw, title)
    if key in CHAPTERS_FROM:
        body = add_chapters(body, normalize(open(os.path.join(d, CHAPTERS_FROM[key]), encoding='utf-8').read(), title))
    if len(re.sub(r'\s+', '', body)) < 400:
        skipped.append((key, 'نص قصير أو فارغ')); continue
    n = len(re.findall(r'(?m)^#### المادة', body))
    out = os.path.join(LIB, domain(rel), slug(title))
    if os.path.exists(out): out += '-' + key
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, 'full_text.md'), 'w', encoding='utf-8').write(body)
    json.dump(meta_for(rel, m, n), open(os.path.join(out, 'metadata.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    old = REPLACES.get(key) and os.path.join(LIB, REPLACES[key])
    if old and os.path.isdir(old):
        shutil.rmtree(old)
    elif old and os.path.exists(old):
        os.remove(old)
    done.append((key, n, os.path.relpath(out, LIB)))

for k, n, p in done: print(f'{n:4d}  {k}  ->  {p}')
print('skipped:', skipped)
print(len(done), 'imported')


# فهرس المكتبة: احذف صفوف الملفات المحذوفة، وأعد كتابة قسم النصوص المنقولة
rp = os.path.join(LIB, 'README.md')
L = open(rp, encoding='utf-8').read().split('\n')
def dead(l):
    m = re.search(r'\]\(([^)]+\.md)\)', l)
    return l.startswith('|') and ((m and not os.path.exists(os.path.join(LIB, m.group(1))))
                                  or 'نظام المنافسات والمشتريات الحكومية (م/76' in l and '](' not in l)
L = [l for l in L if not dead(l)]
S, E = '<!-- import_sl:start -->', '<!-- import_sl:end -->'
if S in L: L = L[:L.index(S)] + L[L.index(E) + 1:]
rows = []
for mp in sorted(glob.glob(os.path.join(LIB, '*', '*', 'metadata.json'))):
    md = json.load(open(mp, encoding='utf-8')); rn = md.get('repository_notes', {})
    if MARK not in rn: continue
    rel = os.path.relpath(os.path.dirname(mp), LIB); ls = md['legal_status']
    st = 'معتمد من صاحب المشروع' if ls.get('owner_approved') else ('موثق مادة بمادة' if ls.get('is_verified') else 'منقول من المصدر الرسمي، لم يراجع')
    if ls.get('status') == 'enacted_not_yet_effective': st += '؛ صادر ولم يبدأ العمل به'
    rows.append(f"| {rel.split('/')[0]} | [{md['title']}]({rel}/full_text.md) | {rn.get('article_headings') or '—'} | {st} |")
sec = [S, '## نصوص منقولة من مستودع saudi-legislation', '',
       'نصوص صفحات المصادر الرسمية (أم القرى، الموارد البشرية، التأمينات، المالية) كما نقلها مستودع `ahzh999-rgb/saudi-legislation`، بصيغة مجلد فيه `full_text.md` و`metadata.json`.',
       'تُحدَّث بتشغيل `python3 site/import_sl.py <مسار saudi-legislation> مكتبة-التشريعات` ثم `python3 site/build_data.py مكتبة-التشريعات site/public`. لا تُعدَّل يدوياً: التعديل يكون في المستودع المصدر.',
       'لا يُنقل منه النص المستخرج آلياً من PDF (EXTRACTED_TEXT)، لأن ترتيب الحروف والأرقام فيه مضطرب؛ تبقى لتلك الأنظمة نسخ المكتبة.', '',
       '| المجال | الملف | المواد | الحالة |', '|---|---|---|---|'] + rows + ['', E, '']
at = next((i for i, l in enumerate(L) if l.startswith('## تنبيه')), len(L))
while at and not L[at - 1].strip():  # لا تتراكم الأسطر الفارغة مع كل تشغيل
    L.pop(at - 1); at -= 1
L = L[:at] + [''] + sec + L[at:]
open(rp, 'w', encoding='utf-8').write('\n'.join(L))
