// Search normalization never changes the text displayed or copied.
export function normalize(value) {
  return String(value || '').normalize('NFKC')
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ\u200e\u200f]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).toLowerCase();
}
export const CATEGORIES = [
  ['all','جميع المجالات'], ['procurement','المنافسات والمشتريات'],
  ['civil','الخدمة المدنية'], ['labour','العمل'], ['retirement','التقاعد العسكري'],
  ['privatization','التخصيص'], ['property','عقارات الدولة'],
  ['judiciary','القضاء الإداري'], ['money','المالية العامة'], ['other','تنظيمات أخرى'],
];
export function categoryOf(id) {
  if (/^SA-(LAW|REG)-GTP-|^local-content$|^procurement-|^conflicts-of-interest$|^local-content-organization$|^expro-organization$/.test(id)) return 'procurement';
  if (/^civil-service$|^hr-|^discipline-|^public-employees|^talent-/.test(id)) return 'civil';
  if (/^military-retirement$/.test(id)) return 'retirement';
  if (/^labour-|^maritime-|^agriculture-/.test(id)) return 'labour';
  if (/^privatization-/.test(id)) return 'privatization';
  if (/^state-property-/.test(id)) return 'property';
  if (/^administrative-/.test(id)) return 'judiciary';
  if (/^public-money-|^revenue-sharing-/.test(id)) return 'money';
  return 'other';
}
export function buildCatalog(data) {
  let sectionId = 0;
  return data.docs.map(doc => ({...doc, category:categoryOf(doc.id), documentType:documentType(doc), searchableTitle:normalize(doc.title),
    articles:doc.secs.map(([heading,body]) => ({id:sectionId++,heading,body,
      key:heading.replace(/^المادة\s*/,''),searchable:normalize(heading+' '+body)})),
  }));
}
const SEARCH_STOP = new Set('ما ماذا هل متى كيف من في على عن هي هو شروط الشروط ضوابط الضوابط حالات الحالات يجوز تجيز التي الذي'.split(' '));
function searchTerms(query) {
  return normalize(query).match(/[\p{L}\p{N}]+/gu)?.filter(t=>!SEARCH_STOP.has(t)).map(t=>t.replace(/^ال(?=.{3})/,''))||[];
}
export function matchingArticles(doc, query) {
  const q=normalize(query).trim(),terms=searchTerms(query);
  if (!q) return doc.articles;
  const number=q.match(/^(?:الماده\s*)?(\d+)(?:-bis(?:-(\d+))?|\s*مكرر(?:\s*(\d+))?)?$/);
  if (number) {
    const repeated=/-bis|مكرر/.test(q),suffix=number[2]||number[3];
    const key=number[1]+(repeated?'-bis'+(suffix?'-'+suffix:''):'');
    return doc.articles.filter(a=>normalize(a.key)===key);
  }
  if (!terms.length) return [];
  const matches=doc.articles.filter(a=>terms.every(term=>a.searchable.includes(term)));
  const requestsConditions=/شروط|حالات|يجوز|متي/.test(q);
  function score(a){
    let score=0;
    for(const term of terms){const p=a.searchable.indexOf(term);score+=p>=0?Math.max(0,120-p):0;}
    if(requestsConditions&&/في الحالات|الحالات الاتيه/.test(a.searchable))score+=100;
    return score;
  }
  return matches.sort((a,b)=>score(b)-score(a)||a.id-b.id);
}
export function filterCatalog(docs,{query='',category='all',type='all'}={}) {
  const terms=searchTerms(query);
  return docs.filter(d=>(category==='all'||d.category===category)&&(type==='all'||d.documentType===type)).flatMap(doc=>{
    const titleMatch=terms.length>0&&terms.every(t=>doc.searchableTitle.includes(t));
    const matches=matchingArticles(doc,query);
    return !query.trim()||titleMatch||matches.length ? [{doc,matches,titleMatch}] : [];
  });
}
export function futureDate(doc,day) {
  const d=doc.metadata_view?.effectiveness;
  const dates=[...new Set((d?.candidates||[]).filter(c=>c.kind==='recorded'&&
    ['gregorian','unspecified'].includes(c.calendar)&&/^\d{4}-\d{2}-\d{2}$/.test(c.value)&&
    !Number.isNaN(Date.parse(c.value))&&new Date(c.value).toISOString().slice(0,10)===c.value&&Number(c.value.slice(0,4))>=1700).map(c=>c.value))];
  return d?.dimension_status==='VERIFIED'&&dates.length===1&&dates[0]>day?dates[0]:null;
}
export function sourceLink(snapshot,path) {
  if (!/^[a-f0-9]{40}$/.test(snapshot)||typeof path!=='string'||!path||path.startsWith('/')||path.split('/').some(p=>p==='..'||p==='.')||/[\\\u0000-\u001f]/.test(path)) return null;
  return 'https://github.com/ahzh999-rgb/saudi-legislation/blob/'+snapshot+'/'+path.split('/').map(encodeURIComponent).join('/');
}

// Presentation only: canonical bodies, hashes and legal keys remain unchanged.
export function latinDigits(value) {
  return String(value ?? '').replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c>='۰'?1776:1632)));
}
export function articleLabel(value) {
  return latinDigits(value).replace(/(\d+)-bis(?:-(\d+))?/g,(_,n,repeat)=>n+' مكرر'+(repeat?' '+repeat:''))
    .replace(/\bArticle\s*(\d+)/gi,'المادة $1');
}
export function documentType(doc) {
  const title=doc.title||'';
  if(/^نظام\s/.test(title))return 'law';
  if(/^اللائحة|^لائحة/.test(title))return 'regulation';
  if(/^تنظيم\s/.test(title))return 'organization';
  return 'rules';
}
export const DOCUMENT_TYPES=[
  ['all','جميع الأنظمة واللوائح'],['law','الأنظمة'],['regulation','اللوائح'],
  ['rules','القواعد والضوابط'],['organization','التنظيمات'],['decision','القرارات'],
  ['decree','المراسيم الملكية'],['gazette','أعداد أم القرى'],
];
export function fileLabel(file,issueNumber) {
  const name=(file.path||'').split('/').pop()||'';
  if(!issueNumber){if(file.format==='pdf')return 'نسخة القرار المؤرشفة';if(['png','jpg','jpeg','webp'].includes(file.format))return 'صورة المصدر';return 'نسخة نصية من المصدر';}
  const article=name.match(/article[-_]?(\d+)/i);
  const page=name.match(/page[-_]?(\d+)/i);
  const pages=name.match(/pages(\d+)(?:-and(\d+))?/i);
  if(article)return 'مقتطف مصوّر من المادة '+Number(article[1]);
  if(/portal|widget|listing/i.test(name))return 'صورة من سجل النشر';
  if(pages)return 'مقتطف من الصفحة '+Number(pages[1])+(pages[2]?' والصفحة '+Number(pages[2]):'');
  if(page)return 'الصفحة '+Number(page[1])+' من العدد';
  if(file.format==='pdf')return issueNumber?'ملف العدد ('+latinDigits(issueNumber)+')':'نسخة القرار المؤرشفة';
  if(['png','jpg','jpeg','webp'].includes(file.format))return issueNumber?'صورة شاهد للعدد ('+latinDigits(issueNumber)+')':'صورة المصدر';
  if(['html','txt','md'].includes(file.format))return 'نسخة نصية من المصدر';
  return 'المصدر المؤرشف';
}
