"""يبني ملفات الموقع من مكتبة التشريعات.

الاستخدام: python3 build_data.py ../مكتبة-التشريعات public
المخرجات:
  public/data.json   نصوص المكتبة مقسمة إلى أقسام، للبحث في المتصفح
  public/s/<n>.json  كل قسم في ملف مستقل، يقرؤه الخادم ليبني الطلب إلى Claude
  public/rules.txt   تعليمات الوكيل (بدون سجل الاختبارات)
"""
import os, re, json, sys, shutil

root = sys.argv[1]; out = sys.argv[2]
docs = []
for dp, dn, fn in sorted(os.walk(root)):
    dn.sort()
    for f in sorted(fn):
        if not f.endswith('.md') or f in ('README.md', 'تعليمات-الوكيل.md'): continue
        p = os.path.join(dp, f); rel = os.path.relpath(p, root)
        txt = open(p, encoding='utf-8').read()
        m = re.search(r'^# (.+)$', txt, re.M)
        title = m.group(1).strip() if m else f[:-3]
        meta = {}
        for k in ('أداة الإصدار', 'الحالة'):
            mm = re.search(r'\*\*' + k + r':\*\*\s*(.+)', txt)
            if mm: meta[k] = mm.group(1).strip()[:200]
        txt = re.sub(r'<!--\s*ص\s*(\d+)\s*-->', r'(ص \1)', txt)
        txt = re.sub(r'<!--.*?-->', '', txt, flags=re.S)
        secs = []
        chapter = ''  # عنوان الباب أو الفصل الذي تقع فيه المادة، يساعد البحث
        for part in re.split(r'(?m)^(?=### )', txt):
            part = part.strip()
            if not part: continue
            h = part.split('\n', 1)[0].lstrip('#').strip()
            if part.startswith('### ') and chapter:
                h += ' · ' + chapter
            chs = re.findall(r'(?m)^##? (?!#)(.+)$', part)
            if chs:
                c = chs[-1].strip()
                chapter = c.split(':', 1)[1].strip() if ':' in c else c
                if chapter == title: chapter = ''
            body = part
            # تقسيم الأقسام الطويلة جداً
            while len(body) > 6000:
                cut = body.rfind('\n', 0, 6000)
                if cut < 2000: cut = 6000
                secs.append((h, body[:cut])); body = '(تابع) ' + body[cut:]
            secs.append((h, body))
        docs.append({'path': rel, 'title': title, 'meta': meta,
                     'kind': 'card' if rel.startswith('بطاقات') else 'text',
                     'secs': [[h, b] for h, b in secs]})

os.makedirs(out, exist_ok=True)
json.dump({'docs': docs}, open(os.path.join(out, 'data.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))

sdir = os.path.join(out, 's')
shutil.rmtree(sdir, ignore_errors=True); os.makedirs(sdir)
n = 0
for d in docs:
    for h, b in d['secs']:
        json.dump({'t': d['title'], 'm': d['meta'], 'h': h, 'b': b},
                  open(os.path.join(sdir, f'{n}.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, separators=(',', ':'))
        n += 1

rules = open(os.path.join(root, 'تعليمات-الوكيل.md'), encoding='utf-8').read()
open(os.path.join(out, 'rules.txt'), 'w', encoding='utf-8').write(rules.split('## سجل الاختبارات')[0].strip() + '\n')
print(len(docs), 'docs,', n, 'sections')
