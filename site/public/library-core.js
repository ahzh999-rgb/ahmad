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
  return data.docs.map(doc => ({...doc, category:categoryOf(doc.id), searchableTitle:normalize(doc.title),
    articles:doc.secs.map(([heading,body]) => ({id:sectionId++,heading,body,
      key:heading.replace(/^المادة\s*/,''),searchable:normalize(heading+' '+body)})),
  }));
}
export function matchingArticles(doc, query) {
  const q=normalize(query).trim(), terms=q.split(/\s+/).filter(Boolean);
  if (!terms.length) return doc.articles;
  const number=q.match(/^(?:الماده\s*)?(\d+(?:-bis(?:-\d+)?)?)$/);
  if (number) return doc.articles.filter(a=>normalize(a.key)===number[1]);
  return doc.articles.filter(a=>terms.every(term=>a.searchable.includes(term)));
}
export function filterCatalog(docs,{query='',category='all'}={}) {
  const terms=normalize(query).trim().split(/\s+/).filter(Boolean);
  return docs.filter(d=>category==='all'||d.category===category).flatMap(doc=>{
    const titleMatch=terms.length>0&&terms.every(t=>doc.searchableTitle.includes(t));
    const matches=matchingArticles(doc,query);
    return !terms.length||titleMatch||matches.length ? [{doc,matches,titleMatch}] : [];
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
