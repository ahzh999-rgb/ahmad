import { checkedCatalog, checkedSection, checkedInventory } from './source-guard.js';
import { buildCatalog, filterCatalog, matchingArticles, normalize, CATEGORIES, futureDate, sourceLink } from './library-core.js';

const $=id=>document.getElementById(id), day=new Date().toISOString().slice(0,10);
const number=n=>new Intl.NumberFormat('ar-SA').format(n);
const categoryName=id=>CATEGORIES.find(([key])=>key===id)?.[1]||'تنظيمات أخرى';
let manifest,inventory,docs=[],currentDoc=null,currentArticle=null,requestSerial=0,catalogScroll=0;
const sectionCache=new Map();
function el(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function link(text,href,className){const e=el('a',text,className);e.href=href;return e;}
function external(text,href){const a=link(text,href);a.target='_blank';a.rel='noopener noreferrer';return a;}
function badge(text,future=false){return el('span',text,'badge'+(future?' future':''));}
function urlFor(changes){const u=new URL(location.href);for(const [key,value] of Object.entries(changes)){if(value)u.searchParams.set(key,value);else u.searchParams.delete(key);}return u.pathname+u.search;}
function navigate(href){history.pushState(null,'',href);render(true);}
function statusLabel(v){return ({VERIFIED:'موثق ضمن النطاق المسجل',OWNER_ACCEPTED:'مقبول من صاحب المشروع',PARTIAL:'تحقق جزئي',UNKNOWN:'غير مثبت',NOT_APPLICABLE:'غير منطبق'})[v]||'راجع سجل المصدر';}
function futureBadge(doc){const date=futureDate(doc,day);return date?badge('نفاذ مسجل مستقبلًا · '+date,true):null;}
function appendBadges(parent,doc){parent.append(badge(number(doc.articles.length)+' مادة متاحة'));const f=futureBadge(doc);if(f)parent.append(f);}
function renderCards(){
 if(collectionView()!=='articles'){renderCollectionCards();return;}
 const query=$('search').value,category=$('category').value;
 const rows=filterCatalog(docs,{query,category}),container=$('documents');container.replaceChildren();
 $('result-count').textContent=number(rows.length)+' من '+number(docs.length)+' وثيقة';$('empty').hidden=rows.length>0;
 for(const {doc,matches,titleMatch} of rows){
  const a=link('',urlFor({doc:doc.id,article:query.trim()&&!titleMatch?matches[0]?.key:null,within:query.trim()&&!titleMatch?query:null}),'card');a.dataset.internal='';
  a.append(el('span',categoryName(doc.category),'card-category'),el('h3',doc.title));
  const meta=el('div',undefined,'card-meta');appendBadges(meta,doc);a.append(meta);
  if(query.trim())a.append(el('span',titleMatch?'تطابق في اسم الوثيقة':number(matches.length)+' مادة مطابقة للبحث','small muted'));
  const bottom=el('div',undefined,'card-bottom');bottom.append(el('span','ضمن نسخة الموقع'),el('span','تصفح المواد ←'));a.append(bottom);container.append(a);
 }
}
function metadataItem(title,values,note){const block=el('div',undefined,'metadata-item');block.append(el('strong',title));for(const value of values)block.append(el('p',value));if(note)block.append(el('small',note));return block;}
function renderMetadata(doc){
 const grid=el('div',undefined,'metadata-grid');
 grid.append(metadataItem('التغطية المتاحة',[number(doc.articles.length)+' مادة مؤهلة في نسخة الموقع'],'لا يُعرف اكتمال الوثيقة من هذا العدد وحده.'));
 const verified=doc.verification||{};
 for(const [key,title] of [['official_match','المقابلة الرسمية'],['amendments','التعديلات'],['publication','النشر'],['effectiveness','النفاذ'],['owner_approval','قبول صاحب المشروع']]){
  const v=verified[key]||{};grid.append(metadataItem(title,[statusLabel(v.status)],v.as_of?'تاريخ المراجعة المسجل: '+v.as_of:undefined));
 }
 for(const [key,title] of [['issuance','تواريخ الإصدار المسجلة'],['publication','تواريخ النشر المسجلة'],['effectiveness','تواريخ النفاذ المسجلة']]){
  const candidates=doc.metadata_view?.[key]?.candidates||[];
  const entries=[...new Set(candidates.map(c=>String(c.value)+' ('+(({hijri:'هجري',gregorian:'ميلادي',unspecified:'التقويم غير مصرح به'})[c.calendar]||'التقويم غير مصرح به')+') · '+(({recorded:'مسجل',reported_alternative:'قيمة بديلة مسجلة',calculated:'محسوب'})[c.kind]||'كما ورد بالمصدر')))];
  grid.append(metadataItem(title,entries.length?entries:['غير متاحة في بيانات هذه النسخة'],'القيم المسجلة لا تحسم التطبيق على الواقعة؛ قد تخص نسخًا أو أحداثًا مختلفة.'));
 }
 const path=sourceLink(manifest.commit,doc.path);if(path){const b=metadataItem('سجل بيانات الوثيقة',[]);b.append(external('فتح السجل المؤرشف',path));grid.append(b);}
 $('document-metadata').replaceChildren(grid);
 const details=el('details');details.append(el('summary','نطاقات التحقق كما سجّلها المصدر'));
 for(const [key,title] of [['official_match','المقابلة'],['amendments','التعديلات'],['effectiveness','النفاذ'],['owner_approval','قبول المالك']])if(verified[key]?.scope){details.append(el('p',title,'small'),el('p',verified[key].scope,'raw-scope'));}
 $('document-metadata').append(details);
}
function renderArticleList(){
 const matches=matchingArticles(currentDoc,$('article-search').value);$('article-count').textContent=number(matches.length)+' من '+number(currentDoc.articles.length)+' مادة متاحة';
 const list=$('article-list');list.replaceChildren();
 for(const article of matches){const a=link(article.heading,urlFor({article:article.key,within:$('article-search').value}),'article-link');a.dataset.internal='';if(article.key===currentArticle?.key)a.setAttribute('aria-current','true');list.append(a);}
 if(!matches.length)list.append(el('p','لا توجد مواد مطابقة ضمن المتاح.','small muted'));
}
function sourceDetails(section){
 const details=el('details',undefined,'source-details');details.append(el('summary','نطاق النسخة وبصمة المادة'));
 const dl=el('dl');for(const [title,value] of [['نطاق النسخة كما سجّله المصدر',section.version_scope],['بصمة النص SHA-256',section.body_sha256],['موضع النص المؤرشف',section.source_path]]){dl.append(el('dt',title),el('dd',value||'غير مسجل'));}
 for(const limitation of section.limitations||[])dl.append(el('dt','حد مسجل'),el('dd',limitation));
 details.append(dl);return details;
}
async function loadSection(doc,article){
 const serial=++requestSerial,source=$('article-source');source.replaceChildren(el('p','جارٍ التحقق من مصدر المادة…','muted'));
 try{
  let section=sectionCache.get(article.id);
  if(!section){const response=await fetch('/s/'+article.id+'.json');if(!response.ok)throw new Error('unavailable');section=await checkedSection(await response.text(),manifest,article.id);
   if(section.instrument_id!==doc.id||section.legal_key!==article.key||section.h!==article.heading||section.b!==article.body)throw new Error('source_integrity');sectionCache.set(article.id,section);}
  if(serial!==requestSerial)return;
  source.replaceChildren();
  const verified=el('p');verified.append(badge('تطابقت بصمة المادة مع نسخة الموقع'));source.append(verified);
  source.append(el('p',section.body_kind==='OWNER_ACCEPTED'?'نوع المتن: مقبول من صاحب المشروع ضمن نطاقه المسجل.':'نوع المتن: نص مقابل ضمن النسخة والنطاق المسجلين.'));
  const href=sourceLink(manifest.commit,section.source_path);if(href)source.append(external('فتح المصدر المؤرشف ↗',href));
  source.append(sourceDetails(section),el('p','تطابق البصمة يثبت سلامة النقل من النسخة المثبتة، ولا يثبت حداثة الحكم أو انطباقه.','muted small'));
 }catch{
  if(serial!==requestSerial)return;
  source.replaceChildren(el('p','تعذّر التحقق من ملف مصدر المادة. قد تكون نسخة الموقع قد تغيّرت؛ أعد تحميل المكتبة قبل الاعتماد عليها.'));
  const retry=el('button','إعادة التحقق','quiet');retry.type='button';retry.onclick=()=>loadSection(doc,article);source.append(retry);
 }
}
function render(focus=false){
 const params=new URLSearchParams(location.search),id=params.get('doc');
 renderCollectionChrome();
 if(params.get('record')){renderRecord(params.get('record'),focus);return;}
 $('record-view').hidden=true;
 if(!id){
  requestSerial++;currentDoc=null;currentArticle=null;$('document-view').hidden=true;$('catalog-view').hidden=false;$('load-error').hidden=true;
  $('search').value=(params.get('search')||'').slice(0,200);$('category').value=[...$('category').options].some(option=>option.value===params.get('category'))?params.get('category'):'all';renderCards();
  document.title='المكتبة النظامية | المستشار النظامي';if(focus){$('page-title').tabIndex=-1;$('page-title').focus({preventScroll:true});window.scrollTo(0,catalogScroll);}return;
 }
 const doc=docs.find(d=>d.id===id);
 if(!doc){requestSerial++;currentDoc=null;currentArticle=null;$('document-view').hidden=true;$('catalog-view').hidden=false;$('load-error').hidden=false;$('load-error-message').textContent='الوثيقة المطلوبة غير متاحة في هذه النسخة. يمكنك البحث في الوثائق المتاحة أدناه.';renderCards();return;}
 const changed=currentDoc?.id!==doc.id;currentDoc=doc;
 $('catalog-view').hidden=true;$('document-view').hidden=false;$('load-error').hidden=true;
 $('back').href=urlFor({doc:null,article:null,within:null});$('document-title').textContent=doc.title;$('document-category').textContent=categoryName(doc.category);
 $('document-badges').replaceChildren();appendBadges($('document-badges'),doc);
 const future=futureDate(doc,day);
 $('document-coverage').textContent='المتاح هنا '+number(doc.articles.length)+' مادة مؤهلة فقط. قد تكون الوثيقة جزئية أو من نسخة تاريخية؛ لا تفترض اكتمالها أو حداثتها من هذا العدد.'+(future?' لم يدخل النص حيز النفاذ بعد وفق التاريخ المسجل '+future+'؛ عرضه هنا للقراءة والمقارنة.':' السريان والتطبيق على واقعة يحتاجان تحققًا مستقلاً.');
 if(changed)renderMetadata(doc);
 $('article-search').value=(params.get('within')||'').slice(0,200);
 const key=params.get('article'),article=key?doc.articles.find(a=>a.key===key):doc.articles[0];currentArticle=article||null;
 renderArticleList();
 $('reader').hidden=!article;
 if(article){
  $('article-title').textContent=article.heading;$('article-body').textContent=article.body;
  const q='ما أحكام '+article.heading+' من '+doc.title+'، وما شروط تطبيقها؟';$('ask-article').href='/?q='+encodeURIComponent(q)+'&draft=1';
  loadSection(doc,article);document.title=article.heading+' · '+doc.title+' | المكتبة النظامية';
 }else{
  requestSerial++;$('article-count').textContent='المادة المطلوبة غير متاحة في هذه النسخة. اختر مادة من القائمة.';
 }
 if(focus){if(changed){$('document-title').focus({preventScroll:true});window.scrollTo(0,0);}else if(article){$('article-title').focus({preventScroll:true});if(innerWidth<=640)$('reader').scrollIntoView({block:'start'});}}
}
function reset(){history.replaceState(null,'',urlFor({search:null,category:null}));$('search').value='';$('category').value='all';renderCards();$('search').focus();}
let searchTimer;
$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{history.replaceState(null,'',urlFor({search:$('search').value}));renderCards();},120);});
$('category').addEventListener('change',()=>{history.replaceState(null,'',urlFor({category:$('category').value==='all'?null:$('category').value}));renderCards();});
$('reset').onclick=reset;$('reset-empty').onclick=reset;
$('article-search').addEventListener('input',()=>{history.replaceState(null,'',urlFor({within:$('article-search').value}));renderArticleList();});
document.addEventListener('click',event=>{
 const a=event.target.closest('a[data-internal],#back,#record-back,a[data-view]');if(!a||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
 event.preventDefault();if(!currentDoc)catalogScroll=window.scrollY;navigate(a.href);
});
addEventListener('popstate',()=>{if(manifest)render(true);});
async function copy(button,value,original){
 try{await navigator.clipboard.writeText(value);button.textContent='تم النسخ ✓';}catch{button.textContent='تعذّر النسخ؛ انسخ النص يدويًا';}
 setTimeout(()=>{button.textContent=original;},2000);
}
$('copy-article').onclick=()=>{if(currentArticle)copy($('copy-article'),currentDoc.title+'\n'+currentArticle.heading+'\n\n'+currentArticle.body+'\n\nنسخة الموقع: '+manifest.commit+'\n'+new URL(urlFor({article:currentArticle.key}),location.origin).href,'نسخ المادة');};
$('share-article').onclick=()=>{if(currentArticle)copy($('share-article'),new URL(urlFor({article:currentArticle.key}),location.origin).href,'نسخ رابط المادة');};
$('retry').onclick=()=>location.reload();
const root=document.documentElement,isDark=()=>root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme:dark)').matches;
try{const theme=localStorage.getItem('theme');if(['light','dark'].includes(theme))root.dataset.theme=theme;}catch{}
function paintTheme(){$('theme').textContent=isDark()?'الوضع الفاتح':'الوضع الداكن';}
paintTheme();$('theme').onclick=()=>{root.dataset.theme=isDark()?'light':'dark';try{localStorage.setItem('theme',root.dataset.theme);}catch{}paintTheme();};

function collectionView(){const v=new URLSearchParams(location.search).get('view');return ['decisions','gazette'].includes(v)?v:'articles';}
function collectionRecords(){return collectionView()==='gazette'?inventory.gazette_issues:inventory.decisions;}
function collectionTitle(){return collectionView()==='gazette'?'إصدارات أم القرى':collectionView()==='decisions'?'القرارات وأدوات الإصدار':'الوثائق المتاحة';}
function renderCollectionChrome(){
 const view=collectionView();
 for(const a of document.querySelectorAll('[data-view]')){
  const active=a.dataset.view===view;if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
 }
 $('category-row').hidden=view!=='articles';$('collection-heading').textContent=collectionTitle();$('reset-empty').textContent=view==='articles'?'عرض جميع الوثائق':'عرض جميع السجلات';
 $('search-label').textContent=view==='articles'?'ابحث باسم الوثيقة أو في نصوص المواد':view==='decisions'?'ابحث باسم القرار أو رقمه المسجل':'ابحث برقم العدد أو الوثائق المرتبطة بشواهده';
 $('search').placeholder=view==='articles'?'مثل: الشراء المباشر، الإعارة، المادة 32':view==='decisions'?'مثل: مكافأة مباشرة الأموال العامة، 835':'مثل: 5180، نظام العمل، التخصيص';
 $('collection-note').textContent=view==='articles'?'هذه مكتبة المواد المؤهلة في نسخة الموقع. لا تشمل كل ملفات المستودع، وعدد المواد المتاحة لا يثبت اكتمال الوثيقة أو حداثتها أو سريانها على واقعتك.':view==='decisions'?'هذا فهرس للقرارات وأدوات الإصدار المؤرشفة. إدراج قرار هنا يتيح الوصول إلى سجله ومصدره؛ لا يجعله مؤهلًا لتوليد الأحكام، ولا يثبت اكتمال مرفقاته أو حداثته أو نفاذه.':'هذه أعداد أم القرى الممثلة بملفات أو شواهد في الأرشيف، وليست أرشيفًا شاملًا للجريدة. قد يكون المتاح صور صفحات أو مقتطفات فقط. وجود ملف PDF لا يثبت اكتمال العدد، والوثائق المرتبطة لا تمثل كل محتوياته.';
 const stats=view==='articles'?[[manifest.document_count,'وثيقة متاحة'],[manifest.section_count,'مادة مؤهلة']]:view==='decisions'?[[inventory.decisions.length,'سجل قرار وأداة إصدار']]:[[inventory.gazette_issues.length,'عددًا ممثلًا في الأرشيف'],[inventory.gazette_issues.filter(r=>r.archive_kind==='ISSUE_PDF_COMPLETENESS_UNVERIFIED').length,'أعداد لها ملفات PDF']];
 $('statistics').replaceChildren();for(const [value,label] of stats){const stat=el('span',undefined,'stat');stat.append(el('b',number(value)),el('span',label));$('statistics').append(stat);}
}
function renderCollectionCards(){
 const query=$('search').value,terms=normalizeCollection(query),records=collectionRecords();
 const rows=records.filter(r=>{const text=normalizeCollection([r.title,r.number,r.issue_date_hijri,...(r.related_documents||[]).map(d=>d.title)].filter(Boolean).join(' ')).join(' ');return terms.every(t=>text.includes(t));});
 $('documents').replaceChildren();$('empty').hidden=rows.length>0;$('result-count').textContent=number(rows.length)+' من '+number(records.length)+' سجل';
 for(const record of rows){
  const a=link('',urlFor({doc:null,article:null,within:null,record:record.id}),'card');a.dataset.internal='';
  a.append(el('span',collectionView()==='gazette'?'الجريدة الرسمية · شاهد مؤرشف':record.kind,'card-category'),el('h3',record.title));
  const meta=el('div',undefined,'card-meta');
  if(collectionView()==='gazette')meta.append(badge(record.archive_kind==='ISSUE_PDF_COMPLETENESS_UNVERIFIED'?'ملف PDF · اكتمال العدد غير مثبت':'صفحات أو شواهد فقط'));
  else meta.append(badge('فهرس مصدر · الأهلية مستقلة'));
  a.append(meta);const bottom=el('div',undefined,'card-bottom');bottom.append(el('span',number(record.sources.length)+' ملف مؤرشف'),el('span','السجل والمصادر ←'));a.append(bottom);$('documents').append(a);
 }
}
function normalizeCollection(text){return normalize(text).trim().split(/\s+/).filter(Boolean);}
function recordPanel(title){const p=el('section',undefined,'record-panel');p.append(el('h2',title));return p;}
function renderRecord(id,focus){
 requestSerial++;currentDoc=null;currentArticle=null;$('catalog-view').hidden=true;$('document-view').hidden=true;
 const record=collectionRecords().find(r=>r.id===id);
 if(!record){$('record-view').hidden=true;$('load-error').hidden=false;$('load-error-message').textContent='السجل المطلوب غير متاح في هذه النسخة. ارجع إلى المكتبة للاطلاع على المصادر المتاحة.';return;}
 $('load-error').hidden=true;$('record-view').hidden=false;$('record-title').textContent=record.title;$('record-category').textContent=collectionTitle();$('record-back').href=urlFor({record:null});
 const gazette=collectionView()==='gazette';$('record-badges').replaceChildren(badge(gazette?(record.archive_kind==='ISSUE_PDF_COMPLETENESS_UNVERIFIED'?'اكتمال العدد غير مثبت':'صفحات أو شواهد فقط'):'فهرس مصدر · الأهلية مستقلة'));
 $('record-note').textContent=gazette?'يعرض هذا السجل ما توفر من ملفات وشواهد لهذا العدد. لا يثبت اكتمال العدد أو فهرسة جميع قراراته ولوائحه، ولا تنتقل أهلية الإجابة من شاهد النشر إلى محتوياته.':'هذا سجل تعريفي للقرار ومصادره. لا يتضمن متنًا مؤهلًا لمجرد إدراجه هنا؛ راجع المصدر والمرفقات والتعديلات والنفاذ قبل الاعتماد عليه.';
 const content=$('record-content');content.replaceChildren();
 if(!gazette){
  const panel=recordPanel('بيانات القرار وحدود التحقق'),grid=el('div',undefined,'metadata-grid');
  grid.append(metadataItem('رقم الأداة المسجل',[record.number||'غير مسجل في الحقل المخصص؛ راجع عنوان المصدر']),metadataItem('تاريخ الإصدار الهجري المسجل',[record.issue_date_hijri||'غير متاح في الحقل المخصص']));
  for(const [key,title] of [['issuance','الإصدار'],['publication','النشر'],['official_match','المقابلة'],['effectiveness','النفاذ'],['owner_approval','قبول صاحب المشروع']]){const v=record.verification[key]||{};grid.append(metadataItem(title,[statusLabel(v.status)],v.as_of?'تاريخ المراجعة المسجل: '+v.as_of:undefined));}
  panel.append(grid);
  const details=el('details',undefined,'source-details');details.append(el('summary','نطاقات التحقق كما سجلها المصدر'));
  for(const [key,v] of Object.entries(record.verification))if(v.scope)details.append(el('p',({issuance:'الإصدار',publication:'النشر',official_match:'المقابلة',effectiveness:'النفاذ',owner_approval:'قبول المالك'})[key],'small'),el('p',v.scope,'raw-scope'));
  panel.append(details);const meta=sourceLink(manifest.commit,record.metadata_path);if(meta)panel.append(external('فتح سجل القرار المؤرشف ↗',meta));
  if(record.official_url&&/^https:\/\//.test(record.official_url)){panel.append(el('p','الرابط التالي للناشر وقد يعرض محتوى أحدث من النسخة المؤرشفة.','muted small'),external('فتح صفحة الناشر ↗',record.official_url));}content.append(panel);
 }
 const files=recordPanel(gazette?'ملفات العدد وشواهده':'المصادر المؤرشفة');
 files.append(el('p','روابط الملفات تفتح المستودع الأساسي، وقد تتطلب صلاحية الوصول إليه.','muted small'));
 files.append(el('p',gazette?'قد تتكرر الصفحة في أكثر من ملف. هذه قائمة بالمتاح، وليست إثباتًا لاكتمال العدد.':'فتح المصدر لا يعني أن نصه مفهرس أو مؤهل للإجابة.','muted small'));
 const list=el('ul',undefined,'file-list');
 for(const file of record.sources){const href=sourceLink(manifest.commit,file.path);if(!href)continue;
  const li=el('li');li.append(external((file.format||'ملف').toUpperCase()+' · '+file.path.split('/').pop()+' ↗',href));
  li.append(el('small',file.path));
  if(file.basis)li.append(el('small',file.basis==='archive_path'?'ارتباط رقم العدد مبني على مسار الأرشيف؛ لا يعد مقابلة مستقلة.':'ارتباط رقم العدد من سجل النشر المحفوظ؛ راجع نطاق الدليل.'));
  const proof=file.evidence_path&&file.evidence_path!==file.path?sourceLink(manifest.commit,file.evidence_path):null;if(proof)li.append(external('سجل ربط الشاهد بالعدد',proof));
  const details=el('details',undefined,'source-details');details.append(el('summary','بصمة الملف المسجلة'),el('p',file.sha256,'record-source-fingerprint'));li.append(details);list.append(li);
 }
 files.append(list);if(!record.sources.length)files.append(el('p','لا يوجد ملف مصدر مباشر في هذا السجل؛ راجع بيانات الوثيقة.'));content.append(files);
 if(gazette&&record.related_documents.length){
  const related=recordPanel('وثائق مرتبطة بالشواهد');related.append(el('p','هذه علاقات مسجلة إلى الملفات المتاحة، وليست حصرًا لمحتويات العدد.','muted small'));const links=el('div',undefined,'record-relations');
  for(const d of record.related_documents){const href=d.eligible_article_count?urlFor({record:null,view:null,doc:d.id,search:null,category:null}):sourceLink(manifest.commit,inventory.decisions.find(x=>x.id===d.id)?.metadata_path);
   if(href){const a=link(d.title,href,'quiet');if(d.eligible_article_count)a.dataset.internal='';else{a.target='_blank';a.rel='noopener noreferrer';}links.append(a);}else links.append(el('span',d.title+' · متن غير متاح في مكتبة المواد','small muted'));}
  related.append(links);content.append(related);
 }
 document.title=record.title+' | المكتبة النظامية';if(focus){$('record-title').focus({preventScroll:true});window.scrollTo(0,0);}
}
async function start(){
 $('catalog-view').hidden=true;
 try{
  const [mr,dr,ir]=await Promise.all([fetch('/source-manifest.json'),fetch('/data.json'),fetch('/library-inventory.json')]);if(!mr.ok||!dr.ok||!ir.ok)throw new Error('unavailable');
  manifest=await mr.json();if(manifest.schema_version!==1||manifest.repository!=='ahzh999-rgb/saudi-legislation'||!/^[a-f0-9]{40}$/.test(manifest.commit||''))throw new Error('source_integrity');
  docs=buildCatalog(await checkedCatalog(await dr.text(),manifest));
  inventory=await checkedInventory(await ir.text(),manifest);
  for(const [id,name] of CATEGORIES)if(id!=='all'&&docs.some(d=>d.category===id)){const option=el('option',name);option.value=id;$('category').append(option);}
  $('statistics').replaceChildren();for(const [value,label] of [[manifest.document_count,'وثيقة متاحة'],[manifest.section_count,'مادة مؤهلة']]){const stat=el('span',undefined,'stat');stat.append(el('b',number(value)),el('span',label));$('statistics').append(stat);}
  $('snapshot').append(document.createTextNode('نسخة المكتبة: '),external(manifest.commit.slice(0,8),'https://github.com/ahzh999-rgb/saudi-legislation/tree/'+manifest.commit),document.createTextNode(' · رقم النسخة لا يحدد تاريخ المراجعة القانونية.'));
  $('load-state').hidden=true;render();
 }catch{$('load-state').hidden=true;$('catalog-view').hidden=true;$('document-view').hidden=true;$('record-view').hidden=true;$('load-error').hidden=false;$('load-error-message').textContent='تعذّر تحميل نسخة مكتبة متطابقة. تحقق من الاتصال ثم أعد المحاولة؛ لن نعرض بيانات لم يكتمل التحقق منها.';}
}
start();
