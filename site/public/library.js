import { checkedCatalog, checkedSection, checkedInventory } from './source-guard.js';
import { buildCatalog, filterCatalog, matchingArticles, normalize, CATEGORIES, futureDate, sourceLink, readableFileLink, latinDigits, articleLabel, displayTitle, fileLabel, referenceUnit } from './library-core.js';

const $=id=>document.getElementById(id), day=new Date().toISOString().slice(0,10);
const number=n=>new Intl.NumberFormat('en-US').format(n);
const categoryName=id=>CATEGORIES.find(([key])=>key===id)?.[1]||'تنظيمات أخرى';
let manifest,inventory,docs=[],currentDoc=null,currentArticle=null,requestSerial=0,catalogScroll=0;
const sectionCache=new Map();
function el(tag,text,className){
 const e=document.createElement(tag);
 if(text!==undefined)for(const part of articleLabel(text).split(/(\d{4}[-/]\d{2}[-/]\d{2})/)){
  if(/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(part)){const date=document.createElement('bdi');date.dir='ltr';date.textContent=part;e.append(date);}else e.append(document.createTextNode(part));
 }
 if(className)e.className=className;return e;
}
function link(text,href,className){const e=el('a',text,className);e.href=href;return e;}
function external(text,href){const a=link(text,href);a.target='_blank';a.rel='noopener noreferrer';return a;}
function badge(text,future=false){return el('span',text,'badge'+(future?' future':''));}
function urlFor(changes){const u=new URL(location.href);for(const [key,value] of Object.entries(changes)){if(value)u.searchParams.set(key,value);else u.searchParams.delete(key);}return u.pathname+u.search;}
function navigate(href){history.pushState(null,'',href);render(true);}
function statusLabel(v){return ({VERIFIED:'موثق ضمن النطاق المسجل',OWNER_ACCEPTED:'مقبول من صاحب المشروع',PARTIAL:'تحقق جزئي',UNKNOWN:'غير مثبت',NOT_APPLICABLE:'غير منطبق'})[v]||'راجع سجل المصدر';}
function futureBadge(doc){const date=futureDate(doc,day);return date?badge('نفاذ مسجل مستقبلًا · '+date,true):null;}
function appendBadges(parent,doc){parent.append(badge(number(doc.articles.length)+' '+referenceUnit(doc)+' متاحة'));const f=futureBadge(doc);if(f)parent.append(f);}
function renderCards(){
 if(collectionView()!=='articles'){renderCollectionCards();return;}
 const query=$('search').value,category=$('category').value;
 const rows=filterCatalog(docs,{query,category,type:currentType()}),container=$('documents');container.replaceChildren();
 $('result-count').textContent=number(rows.length)+' من '+number(docs.length)+' وثيقة';$('empty').hidden=rows.length>0;
 for(const {doc,matches,titleMatch} of rows){
  const a=link('',urlFor({doc:doc.id,article:query.trim()&&!titleMatch?matches[0]?.key:null,within:query.trim()&&!titleMatch?query:null}),'card');a.dataset.internal='';
  a.append(el('span',categoryName(doc.category),'card-category'),el('h3',displayTitle(doc.title)));
  const meta=el('div',undefined,'card-meta');appendBadges(meta,doc);a.append(meta);
  if(query.trim())a.append(el('span',titleMatch?'تطابق في اسم الوثيقة':number(matches.length)+' '+referenceUnit(doc)+' مطابقة للبحث','small muted'));
  const bottom=el('div',undefined,'card-bottom');bottom.append(el('span','ضمن نسخة الموقع'),el('span','تصفح النصوص ←'));a.append(bottom);container.append(a);
 }
}
function metadataItem(title,values,note){const block=el('div',undefined,'metadata-item');block.append(el('strong',title));for(const value of values)block.append(el('p',value));if(note)block.append(el('small',note));return block;}
function renderMetadata(doc){
 const grid=el('div',undefined,'metadata-grid');
 grid.append(metadataItem('التغطية المتاحة',[number(doc.articles.length)+' '+referenceUnit(doc)+' متاحة في الموقع'],'لا يُعرف اكتمال الوثيقة من هذا العدد وحده.'));
 const verified=doc.verification||{};
 for(const [key,title] of [['official_match','المقابلة الرسمية'],['amendments','التعديلات'],['publication','النشر'],['effectiveness','النفاذ'],['owner_approval','قبول صاحب المشروع']]){
  const v=verified[key]||{};grid.append(metadataItem(title,[statusLabel(v.status)],v.as_of?'تاريخ المراجعة المسجل: '+v.as_of:undefined));
 }
 for(const [key,title] of [['issuance','تواريخ الإصدار المسجلة'],['publication','تواريخ النشر المسجلة'],['effectiveness','تواريخ النفاذ المسجلة']]){
  const candidates=doc.metadata_view?.[key]?.candidates||[];
  const entries=[...new Set(candidates.map(c=>String(c.value)+' ('+(({hijri:'هجري',gregorian:'ميلادي',unspecified:'التقويم غير مصرح به'})[c.calendar]||'التقويم غير مصرح به')+') · '+(({recorded:'مسجل',reported_alternative:'قيمة بديلة مسجلة',calculated:'محسوب'})[c.kind]||'كما ورد بالمصدر')))];
  grid.append(metadataItem(title,entries.length?entries:['غير متاحة في بيانات هذه النسخة'],'القيم المسجلة لا تحسم التطبيق على الواقعة؛ قد تخص نسخًا أو أحداثًا مختلفة.'));
 }
 const path=sourceLink(manifest.commit,doc.path);if(path){const b=metadataItem('سجل بيانات الوثيقة',[]);b.append(external('سجل بيانات الوثيقة (JSON) ↗',path));grid.append(b);}
 $('document-metadata').replaceChildren(grid);
 $('document-metadata').append(el('p','راجع سجل المصدر لمعرفة النطاق التفصيلي للمقابلة والتعديلات؛ حالة التحقق تخص النسخة الموثقة فقط.','muted small'));
}
function renderArticleList(){
 const matches=matchingArticles(currentDoc,$('article-search').value);$('article-count').textContent=number(matches.length)+' من '+number(currentDoc.articles.length)+' '+referenceUnit(currentDoc)+' متاحة';
 const list=$('article-list');list.replaceChildren();
 for(const article of matches){const a=link(article.displayHeading,urlFor({article:article.key,within:$('article-search').value}),'article-link');a.dataset.internal='';if(article.key===currentArticle?.key)a.setAttribute('aria-current','true');list.append(a);}
 if(!matches.length)list.append(el('p','لا توجد مواد مطابقة ضمن المتاح.','small muted'));
}
function sourceDetails(section){
 const details=el('details',undefined,'source-details');details.append(el('summary','معلومات التوثيق'));
 details.append(el('p','تم التحقق من مطابقة النص لنسخة الموقع. لا يثبت ذلك اكتمال التعديلات أو انطباق الحكم على واقعة.'));
 const record=sourceLink(manifest.commit,section.body_record_path);if(record)details.append(external('سجل بيانات النص (JSON) ↗',record));
 return details;
}
async function loadSection(doc,article){
 const serial=++requestSerial,source=$('article-source');source.replaceChildren(el('p','جارٍ التحقق من مصدر النص…','muted'));
 try{
  let section=sectionCache.get(article.id);
  if(!section){const response=await fetch('/s/'+article.id+'.json');if(!response.ok)throw new Error('unavailable');section=await checkedSection(await response.text(),manifest,article.id);
   if(section.instrument_id!==doc.id||section.legal_key!==article.key||section.h!==article.heading||section.b!==article.body)throw new Error('source_integrity');sectionCache.set(article.id,section);}
  if(serial!==requestSerial)return;
  source.replaceChildren();
  const verified=el('p');verified.append(badge('النص مطابق لمصدره المحفوظ'));source.append(verified);
  source.append(el('p',section.body_kind==='OWNER_ACCEPTED'?'نوع المتن: مقبول من صاحب المشروع ضمن نطاقه المسجل.':'نوع المتن: نص مقابل ضمن النسخة والنطاق المسجلين.'));
  const href=readableFileLink(manifest.commit,section.source_path)||sourceLink(manifest.commit,section.source_path);
  if(href){const format=section.source_path.split('.').pop().toLowerCase();source.append(external(fileLabel({path:section.source_path,format})+' ↗',href));}
  source.append(sourceDetails(section),el('p','المطابقة تثبت سلامة نقل النص، ولا تثبت حداثة الحكم أو انطباقه على حالتك.','muted small'));
 }catch{
  if(serial!==requestSerial)return;
  source.replaceChildren(el('p','تعذّر التحقق من ملف مصدر النص. قد تكون نسخة الموقع قد تغيّرت؛ أعد تحميل المكتبة قبل الاعتماد عليها.'));
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
 $('back').href=urlFor({doc:null,article:null,within:null});$('document-title').textContent=articleLabel(displayTitle(doc.title));$('document-category').textContent=categoryName(doc.category);
 $('document-badges').replaceChildren();appendBadges($('document-badges'),doc);
 renderDocumentGazettes(doc);
 const future=futureDate(doc,day);
 $('document-coverage').textContent='المعروض '+number(doc.articles.length)+' '+referenceUnit(doc)+' من النسخة المحفوظة؛ اكتمال الوثيقة وحداثتها يحتاجان مراجعة.'+
  (doc.id==='administrative-execution-executive'?' هذه مجموعات فقرات اللائحة المرتبطة بمواد النظام، وليست مواد مستقلة في اللائحة.':'')+
  (future?' لم يدخل النص حيز النفاذ بعد وفق التاريخ المسجل '+future+'؛ عرضه هنا للقراءة والمقارنة.':' السريان والتطبيق على واقعة يحتاجان تحققًا مستقلاً.');
 if(changed)renderMetadata(doc);
 $('article-search').value=(params.get('within')||'').slice(0,200);
 const key=params.get('article'),article=key?doc.articles.find(a=>a.key===key):doc.articles[0];currentArticle=article||null;
 renderArticleList();
 $('reader').hidden=!article;
 if(article){
  $('article-title').textContent=article.displayHeading;$('article-body').textContent=latinDigits(article.body);
  const grouped=doc.id==='administrative-execution-executive';
  $('copy-article').textContent=grouped?'نسخ الأحكام':'نسخ المادة';$('share-article').textContent=grouped?'نسخ رابط الأحكام':'نسخ رابط المادة';
  $('ask-article').textContent=grouped?'استفسر عن هذه الأحكام':'استفسر عن هذه المادة';
  $('article-search').placeholder=grouped?'كلمة أو رقم مادة النظام':'كلمة أو رقم مادة';
  const q='ما أحكام '+article.displayHeading+' من '+displayTitle(doc.title)+'، وما شروط تطبيقها؟';$('ask-article').href='/?q='+encodeURIComponent(q)+'&draft=1';
  loadSection(doc,article);document.title=articleLabel(article.displayHeading+' · '+displayTitle(doc.title))+' | المكتبة النظامية';
 }else{
  requestSerial++;$('article-count').textContent='النص المطلوب غير متاح في هذه النسخة. اختر نصًا من القائمة.';
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
 // Callers format visible text; never rewrite an identifier inside a URL.
 try{await navigator.clipboard.writeText(value);button.textContent='تم النسخ ✓';}catch{button.textContent='تعذّر النسخ؛ انسخ النص يدويًا';}
 setTimeout(()=>{button.textContent=original;},2000);
}
$('copy-article').onclick=()=>{if(currentArticle)copy($('copy-article'),articleLabel(displayTitle(currentDoc.title))+'\n'+currentArticle.displayHeading+'\n\n'+latinDigits(currentArticle.body)+'\n\nنسخة الموقع: '+manifest.commit+'\n'+new URL(urlFor({article:currentArticle.key}),location.origin).href,referenceUnit(currentDoc)==='مجموعة أحكام'?'نسخ الأحكام':'نسخ المادة');};
$('share-article').onclick=()=>{if(currentArticle)copy($('share-article'),new URL(urlFor({article:currentArticle.key}),location.origin).href,referenceUnit(currentDoc)==='مجموعة أحكام'?'نسخ رابط الأحكام':'نسخ رابط المادة');};
$('retry').onclick=()=>location.reload();
const root=document.documentElement,isDark=()=>root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme:dark)').matches;
try{const theme=localStorage.getItem('theme');if(['light','dark'].includes(theme))root.dataset.theme=theme;}catch{}
function paintTheme(){$('theme').textContent=isDark()?'الوضع الفاتح':'الوضع الداكن';}
paintTheme();$('theme').onclick=()=>{root.dataset.theme=isDark()?'light':'dark';try{localStorage.setItem('theme',root.dataset.theme);}catch{}paintTheme();};

function collectionView(){const v=new URLSearchParams(location.search).get('view');return ['decisions','gazette'].includes(v)?v:'articles';}
function currentType(){const p=new URLSearchParams(location.search);if(collectionView()==='gazette')return 'gazette';if(collectionView()==='decisions')return ['decision','decree'].includes(p.get('type'))?p.get('type'):'instruments';return ['law','regulation','rules','organization'].includes(p.get('type'))?p.get('type'):'all';}
function collectionRecords(){if(collectionView()==='gazette')return inventory.gazette_issues;const type=currentType();return inventory.decisions.filter(r=>type==='instruments'||(type==='decree'?r.kind==='مرسوم':r.kind!=='مرسوم'));}
$('document-type').addEventListener('change',()=>{const type=$('document-type').value,view=type==='gazette'?'gazette':['decision','decree','instruments'].includes(type)?'decisions':null;navigate(urlFor({view,type:type==='all'?null:type,doc:null,record:null,article:null,within:null,search:null,category:null}));});
function collectionTitle(){return collectionView()==='gazette'?'إصدارات أم القرى':collectionView()==='decisions'?'القرارات وأدوات الإصدار':'الوثائق المتاحة';}
function renderCollectionChrome(){
 const view=collectionView();
 $('document-type').value=currentType();
 for(const a of document.querySelectorAll('[data-view]')){
  const active=a.dataset.view===view;if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
 }
 $('category-row').hidden=view!=='articles';$('collection-heading').textContent=collectionTitle();$('reset-empty').textContent=view==='articles'?'عرض جميع الوثائق':'عرض جميع السجلات';
 $('search-label').textContent=view==='articles'?'ابحث باسم الوثيقة أو في نصوص المواد':view==='decisions'?'ابحث باسم القرار أو رقمه المسجل':'ابحث برقم العدد أو الوثائق المرتبطة بشواهده';
 $('search').placeholder=view==='articles'?'مثل: الشراء المباشر، الإعارة، المادة 32':view==='decisions'?'مثل: مكافأة مباشرة الأموال العامة، 835':'مثل: 5180، نظام العمل، التخصيص';
 $('collection-note').textContent=view==='articles'?'تعرض المكتبة المواد المتاحة للبحث في الموقع، ولا تشمل كل الأنظمة. وعدد المواد المتاحة لا يثبت اكتمال الوثيقة أو حداثتها أو سريانها على واقعتك.':view==='decisions'?'هذا فهرس للقرارات والمراسيم المحفوظة مع مصادرها. القرارات هنا للاطلاع ولا تُستخدم في إجابات الاستفسار، ولا يثبت إدراجها اكتمال مرفقاته أو حداثته أو نفاذه.':'هذه أعداد أم القرى المحفوظة لها ملفات أو صفحات في المكتبة، وليست مجموعة شاملة للجريدة. قد يكون المتاح صور صفحات أو مقتطفات فقط. وجود ملف PDF لا يثبت اكتمال العدد، والوثائق المرتبطة لا تمثل كل محتوياته.';
 const stats=view==='articles'?[[manifest.document_count,'وثيقة متاحة'],[manifest.section_count,'مادة وبند']]:view==='decisions'?[[inventory.decisions.length,'قرار ومرسوم']]:[[inventory.gazette_issues.length,'عددًا محفوظًا'],[inventory.gazette_issues.filter(r=>r.archive_kind==='ISSUE_PDF_COMPLETENESS_UNVERIFIED').length,'أعداد لها ملفات للقراءة']];
 $('statistics').replaceChildren();for(const [value,label] of stats){const stat=el('span',undefined,'stat');stat.append(el('b',number(value)),el('span',label));$('statistics').append(stat);}
}
function renderCollectionCards(){
 const query=$('search').value,terms=normalizeCollection(query),records=collectionRecords();
 const rows=records.filter(r=>{const text=normalizeCollection([r.title,r.number,r.issue_date_hijri,...(r.related_documents||[]).map(d=>d.title)].filter(Boolean).join(' ')).join(' ');return terms.every(t=>text.includes(t));});
 $('documents').replaceChildren();$('empty').hidden=rows.length>0;$('result-count').textContent=number(rows.length)+' من '+number(records.length)+' سجل';
 for(const record of rows){
  const gazette=collectionView()==='gazette';
  const a=link('',urlFor({doc:null,article:null,within:null,record:record.id}),'card');a.dataset.internal='';
  a.append(el('span',gazette?'أم القرى · الجريدة الرسمية':record.kind,'card-category'),el('h3',gazette?'العدد ('+record.issue_number+')':displayTitle(record.title)));
  if(gazette){
   const related=el('p',undefined,'gazette-related');related.append(el('span','مرتبط بالتشريع: '));
   const titles=record.related_documents.map(d=>displayTitle(d.title));
   related.append(document.createTextNode(articleLabel(titles.length?titles.slice(0,2).join('، '):'لم يُستكمل ربط التشريع بهذا الشاهد')));
   if(titles.length>2)related.append(el('span',' · و'+number(titles.length-2)+' أخرى'));a.append(related);
  }
  const meta=el('div',undefined,'card-meta');
  meta.append(badge(gazette?(record.archive_kind==='ISSUE_PDF_COMPLETENESS_UNVERIFIED'?'ملف للعدد · اكتماله غير مثبت':'صفحات أو شواهد من العدد'):(record.official_url?'مع المصدر الرسمي':'مصدر محفوظ')));a.append(meta);
  const bottom=el('div',undefined,'card-bottom');bottom.append(el('span',number(record.sources.length)+' مصدر متاح'),el('span',gazette?'التشريعات والملفات ←':'عرض القرار ومصادره ←'));a.append(bottom);$('documents').append(a);
 }
}
function normalizeCollection(text){return normalize(text).trim().split(/\s+/).filter(Boolean);}
function publisherName(url){const host=new URL(url).hostname.replace(/^www\./,'');return ({'uqn.gov.sa':'جريدة أم القرى','laws.boe.gov.sa':'هيئة الخبراء','boe.gov.sa':'هيئة الخبراء','mof.gov.sa':'وزارة المالية','hrsd.gov.sa':'وزارة الموارد البشرية'})[host]||'موقع الناشر';}
function recordPanel(title){const p=el('section',undefined,'record-panel');p.append(el('h2',title));return p;}
function relatedLink(doc){
 if(doc.eligible_article_count){const a=link(displayTitle(doc.title),urlFor({record:null,view:null,type:null,doc:doc.id,article:null,within:null,search:null,category:null}),'record-document-link');a.dataset.internal='';a.append(el('span','قراءة المواد المتاحة ←'));return a;}
 const decision=inventory.decisions.find(d=>d.id===doc.id);
 if(decision){const a=link(displayTitle(doc.title),urlFor({record:doc.id,view:'decisions',type:'instruments',doc:null,search:null,category:null}),'record-document-link');a.dataset.internal='';a.append(el('span','فتح سجل القرار ←'));return a;}
 const href=sourceLink(manifest.commit,doc.metadata_path);if(href){const a=external(displayTitle(doc.title),href);a.className='record-document-link';a.append(el('span','سجل بيانات التشريع ↗'));return a;}
 return el('p',displayTitle(doc.title)+' · الربط بالمصدر قيد الاستكمال','muted small');
}
function renderDocumentGazettes(doc){
 let box=$('document-gazettes');if(!box){box=el('div',undefined,'document-gazettes');box.id='document-gazettes';$('document-view').insertBefore(box,$('document-view').querySelector('.reader-layout'));}
 const issues=inventory.gazette_issues.filter(issue=>issue.related_documents.some(d=>d.id===doc.id));box.hidden=!issues.length;box.replaceChildren();
 if(!issues.length)return;
 box.append(el('p','أعداد أم القرى المرتبطة بشواهد هذا التشريع'));
 for(const issue of issues){const a=link('العدد ('+issue.issue_number+')',urlFor({doc:null,article:null,within:null,record:issue.id,view:'gazette',type:'gazette',search:null,category:null}));a.dataset.internal='';box.append(a);}
}
function renderRecord(id,focus){
 requestSerial++;currentDoc=null;currentArticle=null;$('catalog-view').hidden=true;$('document-view').hidden=true;
 // Direct links remain valid even when a subtype filter is set.
 const source=collectionView()==='gazette'?inventory.gazette_issues:inventory.decisions;
 const record=source.find(r=>r.id===id);
 if(!record){$('record-view').hidden=true;$('load-error').hidden=false;$('load-error-message').textContent='السجل المطلوب غير متاح في هذه النسخة. ارجع إلى المكتبة للاطلاع على المصادر المتاحة.';return;}
 const gazette=collectionView()==='gazette';
 $('load-error').hidden=true;$('record-view').hidden=false;$('record-title').textContent=articleLabel(gazette?'أم القرى · العدد ('+record.issue_number+')':displayTitle(record.title));$('record-category').textContent=collectionTitle();$('record-back').href=urlFor({record:null});
 $('record-badges').replaceChildren(badge(gazette?(record.archive_kind==='ISSUE_PDF_COMPLETENESS_UNVERIFIED'?'ملف للعدد · اكتماله غير مثبت':'صفحات أو شواهد من العدد'):'قرار محفوظ مع مصدره'));
 $('record-note').textContent=gazette?'الارتباطات أدناه تخص الصفحات المحفوظة من العدد، وقد تتعلق بتعديل أو خبر نشر. لا تمثل قائمة كاملة بمحتويات العدد.':'تتوفر مصادر القرار أدناه. راجع نصه ومرفقاته وتعديلاته وتاريخ نفاذه قبل الاعتماد عليه.';
 const content=$('record-content');content.replaceChildren();
 if(gazette){
  const related=recordPanel('التشريعات المرتبطة بالعدد ('+record.issue_number+')');related.classList.add('record-legal-links');
  if(record.related_documents.length){for(const d of record.related_documents)related.append(relatedLink(d));}
  else related.append(el('p','لم يُستكمل ربط التشريع بهذا الشاهد. الملف المتاح أدناه لا يكفي وحده لتحديد كل محتويات العدد.','muted small'));
  content.append(related);
 }
 if(!gazette){
  const summary=el('div',undefined,'record-summary');
  if(record.number){const field=el('p');field.append(el('strong','رقم القرار'),document.createTextNode(latinDigits(record.number)));summary.append(field);}
  if(record.issue_date_hijri){const field=el('p');field.append(el('strong','تاريخ الإصدار الهجري'),document.createTextNode(latinDigits(record.issue_date_hijri)));summary.append(field);}
  if(summary.childNodes.length)content.append(summary);
 }
 // Reader-facing sources first: the official publisher page, then any PDF or
 // image that opens directly. Archive files on GitHub and the metadata record
 // are kept for specialists inside one collapsed «بيانات التحقق» block.
 const files=recordPanel(gazette?'ملف العدد والصفحات المتاحة':'المصدر الرسمي والتوثيق');
 const official=!gazette&&record.official_url&&/^https:\/\//.test(record.official_url)?record.official_url:null;
 if(official){
  const a=external('قراءة القرار في '+publisherName(official)+' ↗',official);a.className='primary';files.append(a);
  files.append(el('p','قد تعرض صفحة الناشر نسخة أحدث من النسخة المحفوظة في الموقع.','muted small'));
 }
 const list=el('ul',undefined,'file-list'),proofs=[];
 const sorted=[...record.sources].sort((a,b)=>(a.format==='pdf'?-1:0)-(b.format==='pdf'?-1:0)||a.path.localeCompare(b.path));
 let directCount=0,readingShown=false;
 for(const file of sorted){const href=sourceLink(manifest.commit,file.path);if(!href)continue;
  const label=fileLabel(file,gazette?record.issue_number:null),direct=readableFileLink(manifest.commit,file.path);
  proofs.push({label,href,sha256:file.sha256});
  if(file.reading){
   readingShown=true;
   const panel=recordPanel(gazette?'النص المتاح من المصدر':'نص القرار');
   panel.classList.add('record-reading');panel.id='reading-'+file.sha256;
   const toolbar=el('div',undefined,'article-toolbar'),copyButton=el('button','نسخ النص','quiet');copyButton.type='button';
   copyButton.onclick=()=>copy(copyButton,displayTitle(record.title)+'\n\n'+file.reading.text+'\n\n'+new URL('#'+panel.id,location.href).href,'نسخ النص');
   toolbar.append(el('p','نص مستخرج من المصدر المحفوظ؛ لا يشمل المرفقات أو التعديلات اللاحقة.','muted small'),copyButton);
   const text=el('div',undefined,'archived-reading-text');text.textContent=file.reading.text;panel.append(toolbar,text);content.append(panel);
  }else if(direct){directCount++;const li=el('li');li.append(external(label+' ↗',direct));
   if(file.evidence_path&&file.evidence_path!==file.path)li.append(el('small','رقم العدد مرتبط بسجل نشر محفوظ.'));
   list.append(li);}
 }
 if(list.childNodes.length){files.append(list);files.append(el('p','ملفات PDF والصور تفتح مباشرة في المتصفح.','muted small'));}
 if(!record.sources.length)files.append(el('p','لا توجد نسخة محفوظة مرتبطة بهذا السجل حتى الآن.','muted small'));
 else if(!official&&!directCount&&!readingShown)files.append(el('p','لا تتوفر نسخة قراءة داخل الموقع لهذا المصدر.','muted small'));
 // Specialist verification data, collapsed by default.
 const proof=el('details',undefined,'source-archive');proof.append(el('summary','بيانات التحقق للمختصين'));
 if(!gazette&&record.number_basis==='title_transcription')proof.append(el('p','رقم القرار منقول من عنوان السجل، ولا يُعد توثيقًا مستقلًا للإصدار.','muted small'));
 for(const item of proofs){const row=el('p');row.append(external(item.label+' ↗',item.href));
  if(item.sha256){const fp=el('small',undefined,'record-source-fingerprint');fp.textContent='SHA-256: '+item.sha256;row.append(fp);}
  proof.append(row);}
 const meta=!gazette?sourceLink(manifest.commit,record.metadata_path):null;if(meta){const row=el('p');row.append(external('سجل بيانات القرار (JSON) ↗',meta));proof.append(row);}
 if(proof.childNodes.length>1)files.append(proof);
 if(files.childNodes.length>1)content.append(files);
 let details=el('div');
 if(gazette){details=el('details',undefined,'verification');details.append(el('summary','حدود الربط بالعدد'),el('p','قد تتكرر الصفحة في أكثر من ملف. لا يثبت توفر الملفات اكتمال العدد أو فهرسة جميع ما نُشر فيه.','muted small'));}
 if(details.childNodes.length)content.append(details);document.title=articleLabel(displayTitle(record.title))+' | المكتبة النظامية';
 if(focus){$('record-title').focus({preventScroll:true});window.scrollTo(0,0);}
}
async function start(){
 $('catalog-view').hidden=true;
 try{
  const [mr,dr,ir]=await Promise.all([fetch('/source-manifest.json'),fetch('/data.json'),fetch('/library-inventory.json')]);if(!mr.ok||!dr.ok||!ir.ok)throw new Error('unavailable');
  manifest=await mr.json();if(manifest.schema_version!==1||manifest.repository!=='ahzh999-rgb/saudi-legislation'||!/^[a-f0-9]{40}$/.test(manifest.commit||''))throw new Error('source_integrity');
  docs=buildCatalog(await checkedCatalog(await dr.text(),manifest));
  inventory=await checkedInventory(await ir.text(),manifest);
  for(const [id,name] of CATEGORIES)if(id!=='all'&&docs.some(d=>d.category===id)){const option=el('option',name);option.value=id;$('category').append(option);}
  $('statistics').replaceChildren();for(const [value,label] of [[manifest.document_count,'وثيقة متاحة'],[manifest.section_count,'مادة وبند']]){const stat=el('span',undefined,'stat');stat.append(el('b',number(value)),el('span',label));$('statistics').append(stat);}
  $('snapshot').append(document.createTextNode('إصدار بيانات المكتبة: '),external('التفاصيل','https://github.com/ahzh999-rgb/saudi-legislation/tree/'+manifest.commit),document.createTextNode(' · لا يدل الإصدار على تاريخ مراجعة قانونية.'));
  $('load-state').hidden=true;render();
 }catch{$('load-state').hidden=true;$('catalog-view').hidden=true;$('document-view').hidden=true;$('record-view').hidden=true;$('load-error').hidden=false;$('load-error-message').textContent='تعذّر تحميل نسخة مكتبة متطابقة. تحقق من الاتصال ثم أعد المحاولة؛ لن نعرض بيانات لم يكتمل التحقق منها.';}
}
start();
