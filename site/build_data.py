"""يبني ملفات الموقع من مكتبة التشريعات.

الاستخدام: python3 build_data.py ../مكتبة-التشريعات public
المخرجات:
  public/data.json   نصوص المكتبة مقسمة إلى أقسام، للبحث في المتصفح
  public/s/<n>.json  كل قسم في ملف مستقل، يقرؤه الخادم ليبني الطلب إلى Claude
  public/rules.txt   تعليمات الوكيل (بدون سجل الاختبارات)
"""
import os, re, json, sys, shutil

ONES = {'الأول': 1, 'الأولى': 1, 'الحادي': 1, 'الحادية': 1, 'الثاني': 2, 'الثانية': 2,
        'الثالث': 3, 'الثالثة': 3, 'الرابع': 4, 'الرابعة': 4, 'الخامس': 5, 'الخامسة': 5,
        'السادس': 6, 'السادسة': 6, 'السابع': 7, 'السابعة': 7, 'الثامن': 8, 'الثامنة': 8,
        'التاسع': 9, 'التاسعة': 9, 'العاشر': 10, 'العاشرة': 10}
TENS = {'عشر': 10, 'عشرة': 10, 'العشرون': 20, 'الثلاثون': 30, 'الأربعون': 40, 'الخمسون': 50,
        'الستون': 60, 'السبعون': 70, 'الثمانون': 80, 'التسعون': 90}
TENS.update({k[:-2] + 'ين': v for k, v in TENS.items() if k.endswith('ون')})  # «الستين»


def ordinal(words):
    """«الثانية والثلاثون بعد المائة» ← 132. يعيد None إن لم يفهم الصيغة."""
    n = 0
    w = words.replace('بعد المائة', '').replace('بعد المئة', '').strip()
    if w != words.strip(): n = 100
    if w in ('المائة', 'المئة'): return 100
    if not w: return n or None
    got = False
    for t in re.split(r'\s+و?', w):
        t = t.strip()
        if not t: continue
        if t in ONES: n += ONES[t]; got = True
        elif t in TENS: n += TENS[t]; got = True
        else: return None
    return n if got else None

if __name__ == '__main__':
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
            # الصيغة الموثقة: مجلد فيه full_text.md و metadata.json، والمواد بعناوين «#### المادة …»
            mp = os.path.join(dp, 'metadata.json')
            verified = f == 'full_text.md' and os.path.exists(mp)
            if verified:
                md = json.load(open(mp, encoding='utf-8'))
                title = md.get('title') or title
                ins = md.get('instrument', {})
                num = ins.get('number', '')
                if num:
                    kind = {'royal_decree': 'مرسوم ملكي', 'ministerial_decision': 'قرار وزاري',
                            'cabinet_decision': 'قرار مجلس الوزراء'}.get(ins.get('type'), ins.get('type') or 'قرار')
                    date = ins.get('issue_date_hijri', '')
                    meta['أداة الإصدار'] = f"{kind} رقم ({num})" + (f" وتاريخ {date}هـ" if date else '')
                ls = md.get('legal_status', {})
                st = {'in_force': 'ساري', 'repealed': 'ملغى',
                      'enacted_not_yet_effective': 'صادر ولم يبدأ العمل به بعد'}.get(
                    ls.get('status'), 'لم يتأكد سريانه الحالي ولا اكتمال تعديلاته')
                imported = 'imported_from' in md.get('repository_notes', {})
                if ls.get('owner_approved'): st += '، نص معتمد من صاحب المشروع'
                elif ls.get('is_verified'): st += '، نص موثق مادة بمادة'
                elif imported: st += '، نص منقول من المصدر الرسمي ولم يراجع مادة بمادة'
                meta['الحالة'] = st
                # توحيد العناوين مع بقية المكتبة: «### المادة 32 (الثانية والثلاثون)»، والباب والفصل «## …»
                def head(m):
                    lvl, h = m.group(1), m.group(2).strip().rstrip(':').strip()
                    a = re.match(r'المادة\s+(.+)$', h)
                    if lvl == '####' and a:
                        k = ordinal(a.group(1))
                        return f'### المادة {k} ({a.group(1)})' if k else '### ' + h
                    return '## ' + h
                txt = re.sub(r'(?m)^(#{2,4}) (.+?)\s*$', head, txt)
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
