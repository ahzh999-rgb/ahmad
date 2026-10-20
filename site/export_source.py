"""Build answer assets from a clean, pinned saudi-legislation checkout only."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

REPOSITORY='ahzh999-rgb/saudi-legislation'
SITE=Path(__file__).resolve().parent
KINDS={'OFFICIAL_SNAPSHOT','OWNER_ACCEPTED'}
RULES='''# قواعد الإجابة من نسخة المستودع الأساسي
- أجب من المواد المرفقة فقط، مع اسم الوثيقة ورقم المادة واقتباس حرفي قصير.
- الأهلية للبحث لا تثبت السريان الحالي أو التطبيق على واقعة بتاريخ معين.
- افصل قبول صاحب المشروع عن المقابلة المستقلة، واذكر حدود الدليل المؤثرة.
- لا تحول تاريخ النشر إلى تاريخ إصدار، ولا التاريخ المحسوب إلى نفاذ مؤكد.
- لا تستنتج الإلغاء أو عدم صدور لائحة من غيابها في نسخة المكتبة.
- عند السؤال عن التطبيق الزمني، اطلب تاريخ الواقعة والطرح والترسية عند الحاجة، وصرح إن لم تثبت الصيغة الواجبة.
- إذا لم تكف المواد فقل: لم أجد نصاً كافياً ضمن المواد المؤهلة في هذه النسخة.
- افصل الاستنتاج عن النص بعبارة (استنتاج)، ولا تضف نسبة أو مدة غير موجودة في النص.
- اختم بأن الإجابة استرشادية وليست رأياً قانونياً نهائياً، ثم سؤال متابعة واحد عند الحاجة.
'''

def json_text(x):return json.dumps(x,ensure_ascii=False,separators=(',',':'))+'\n'
def run(root,*args):return subprocess.check_output(['git','-C',str(root),*args],text=True).strip()
def eligible_result(result,quality):
    if result.get('status')!='FOUND_SNAPSHOT':return result.get('status','UNAVAILABLE')
    if result.get('body_kind') not in KINDS:return result.get('body_kind','UNKNOWN_KIND')
    if not result.get('body'):return 'EMPTY_BODY'
    if result.get('conflicts'):return 'UNRESOLVED_CONFLICT'
    issues=quality(result['body'])
    if issues:return '+'.join(issues)
    if hashlib.sha256(result['body'].encode()).hexdigest()!=result.get('body_sha256'):return 'BODY_HASH_MISMATCH'
    return None

def collect(root):
    # These adapters belong to the pinned primary repository, not a copied library.
    sys.path.insert(0,str(root/'scripts'))
    from legislation_data import articles,instruments,load
    from retrieve_legislation import retrieve
    from search_legislation import text_quality_issues
    records=instruments();docs=[];sections=[];excluded=Counter()
    registry=load('indexes/file_registry.json');formats={d['id']:d['formats'] for d in registry['documents']}
    related={}
    for r in registry['relations']:related.setdefault(r['from'],[]).append({k:r[k] for k in ('to','type','direction','time_chain')})
    for selection in load('indexes/display_sources.json')['records']:
        ident=selection['id'];rec=records[ident];meta=rec['data'];kept=[]
        for article in articles(ident,display=True):
            result=retrieve(ident,article['legal_key'])
            reason=eligible_result(result,text_quality_issues)
            if reason:excluded[reason]+=1;continue
            kept.append((article,result))
        if not kept:continue
        instrument=meta.get('instrument') or {}
        tool=' '.join(x for x in [instrument.get('type'),instrument.get('number'),instrument.get('issue_date_hijri')] if x)
        doc={'id':ident,'path':rec['metadata'] or rec['index'],'title':rec['title'],
             'meta':{'أداة الإصدار':tool,'الحالة':'نسخة مؤهلة للبحث؛ السريان والتطبيق الزمني يحتاجان تحققاً مستقلاً'},
             'kind':'text','verification':kept[0][1]['verification_summary'],
             'metadata_view':kept[0][1]['metadata_view'],
             'registry':{'file_counts':{k:len(v) for k,v in formats.get(ident,{}).items()},'related':related.get(ident,[])},'secs':[]}
        for article,result in kept:
            h='المادة '+result['legal_key'];body=result['body'];doc['secs'].append([h,body])
            sections.append({'t':doc['title'],'m':doc['meta'],'h':h,'b':body,
                'eligible':True,'body_kind':result['body_kind'],'instrument_id':ident,'legal_key':result['legal_key'],
                'body_sha256':result['body_sha256'],'archived_body_sha256':result['archived_body_sha256'],
                'source_path':result['source_path'],'body_record_path':result['body_record_path'],
                'version_scope':result['version_scope'],'verification_summary':result['verification_summary'],
                'metadata_view':result['metadata_view'],'limitations':result['limitations'],
                'corrections_applied':result.get('corrections_applied',[]),
                'point_in_time_applicability_established':False})
        docs.append(doc)
    if not sections:raise ValueError('No eligible articles; existing assets will not be replaced')
    return docs,sections,dict(sorted(excluded.items()))

def build(source,out,update_lock=False,check=False,lock_path=None):
    source=Path(source).resolve();out=Path(out).resolve();lock_path=Path(lock_path or SITE/'source-lock.json')
    sha=run(source,'rev-parse','HEAD')
    if not re.fullmatch('[0-9a-f]{40}',sha):raise ValueError('Expected full source commit SHA')
    if run(source,'status','--porcelain','--untracked-files=no'):raise ValueError('Source checkout has uncommitted tracked changes')
    remote=run(source,'remote','get-url','origin').removesuffix('.git')
    if remote not in [f'https://github.com/{REPOSITORY}',f'git@github.com:{REPOSITORY}']:raise ValueError('Unexpected source repository')
    lock={'repository':REPOSITORY,'commit':sha,'schema_version':1}
    if not update_lock and json.loads(lock_path.read_text())!=lock:raise ValueError('Source differs from source-lock.json')
    docs,sections,excluded=collect(source)
    for s in sections:s['snapshot']=sha;s['source_url']=f'https://github.com/{REPOSITORY}/blob/{sha}/{s["source_path"]}'
    payload={'snapshot':sha,'repository':REPOSITORY,'docs':docs}
    data=json_text(payload)
    manifest={'schema_version':1,**lock,'document_count':len(docs),'section_count':len(sections),
        'coverage':'selected_display_articles_only; documents without article indexes excluded',
        'eligible_body_kinds':sorted(KINDS),'excluded_article_reason_counts':excluded,
        'currentness_or_applicability_established':False,'data_sha256':hashlib.sha256(data.encode()).hexdigest(),
        'section_sha256':{str(i):hashlib.sha256(json_text(s).encode()).hexdigest() for i,s in enumerate(sections)}}
    outputs={'data.json':data,'rules.txt':RULES,'source-manifest.json':json_text(manifest)}
    outputs.update({f's/{i}.json':json_text(s) for i,s in enumerate(sections)})
    if check:
        for name,content in outputs.items():
            if not (out/name).is_file() or (out/name).read_text()!=content:raise ValueError('Stale source asset: '+name)
        if {x.name for x in (out/'s').glob('*.json')}!={str(i)+'.json' for i in range(len(sections))}:raise ValueError('Unexpected old sections')
    else:
        # Collect and validate everything before replacing the generated directory.
        out.mkdir(parents=True,exist_ok=True)
        if (out/'s').exists():shutil.rmtree(out/'s')
        (out/'s').mkdir()
        for name,content in outputs.items():(out/name).write_text(content)
        if update_lock:lock_path.write_text(json.dumps(lock,indent=2)+'\n')
    print(json.dumps({'commit':sha,'documents':len(docs),'sections':len(sections),'excluded':excluded},ensure_ascii=False))
    return manifest

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source');p.add_argument('--out',default=str(SITE/'public'));p.add_argument('--update-lock',action='store_true');p.add_argument('--check',action='store_true');a=p.parse_args()
    if a.check and a.update_lock:p.error('--check and --update-lock cannot be combined')
    build(a.source,a.out,a.update_lock,a.check)
if __name__=='__main__':main()
