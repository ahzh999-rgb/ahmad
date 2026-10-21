import { articleLabel, referenceLabel, isRegulatoryGroup, sourceLink, readableFileLink } from './library-core.js';

// Only explicit publisher metadata is exported. A publisher page is a
// document-level reference, not a claim that its live bytes match the archive.
export function publisherLink(value) {
  if (typeof value !== 'string' || /[\\\u0000-\u0020]/.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname;
  if (host === 'mu.edu.sa' || host.endsWith('.mu.edu.sa')) {
    return { href:url.href, label:'نسخة منشورة لدى جامعة المجمعة', kind:'publisher_copy' };
  }
  if (!host.endsWith('.gov.sa')) return null;
  const name = host === 'uqn.gov.sa' || host.endsWith('.uqn.gov.sa') ? ' — أم القرى'
    : host === 'laws.boe.gov.sa' ? ' — هيئة الخبراء' : '';
  return { href:url.href, label:'المصدر الرسمي للوثيقة'+name, kind:'official' };
}

function archiveLink(value, snapshot) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const prefix = '/ahzh999-rgb/saudi-legislation/blob/'+snapshot+'/';
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)) return null;
    return sourceLink(snapshot, decodeURIComponent(url.pathname.slice(prefix.length)));
  } catch { return null; }
}

export function sourceLinks(source, snapshot) {
  const links = [];
  if (typeof source.instrument_id === 'string' && source.instrument_id && typeof source.legal_key === 'string' && source.legal_key) {
    links.push({ href:'/library?'+new URLSearchParams({doc:source.instrument_id,article:source.legal_key}), label:isRegulatoryGroup(source.legal_key,source.instrument_id)?'عرض الأحكام':'عرض المادة', kind:'article' });
  }
  const archive = archiveLink(source.source_url, snapshot);
  if (archive) {
    const path=decodeURIComponent(new URL(archive).pathname.split('/').slice(5).join('/'));
    const direct=readableFileLink(snapshot,path);
    links.push({href:direct||archive,label:direct?'فتح ملف المصدر المستخدم':/\.html$/i.test(path)?'ملف HTML المؤرشف (للتوثيق)':'النسخة المؤرشفة المستخدمة',kind:'archive'});
  }
  for (const value of Array.isArray(source.publisher_urls) ? source.publisher_urls : []) {
    const link = publisherLink(value);
    if (link && !links.some(item => item.href === link.href)) links.push(link);
  }
  return links;
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function sourcesHTML(sources, snapshot) {
  if (!Array.isArray(sources) || !sources.length) return '';
  return 'النصوص المرفقة للإجابة:<ul>'+sources.map(source => {
    const links = sourceLinks(source,snapshot).map(link => '<a href="'+escape(link.href)+'"'+
      (link.kind === 'article' ? '' : ' target="_blank" rel="noopener noreferrer"')+'>'+escape(link.label)+'</a>').join('');
    return '<li><strong>'+escape(articleLabel(source.title)+'، '+referenceLabel(source.heading,source.instrument_id))+'</strong>'+
      (source.temporal?.state === 'FUTURE_RECORDED' ? '<span class="tag new">لم يبدأ نفاذه بعد وفق التاريخ المسجل</span>' : '')+
      '<div class="source-links">'+links+'</div></li>';
  }).join('')+'</ul><p class="source-note">روابط الناشر تخص الوثيقة وقد تعرض نسخة مختلفة أو أحدث؛ النسخة المؤرشفة هي مرجع الإجابة، ووجود الرابط لا يثبت السريان أو الانطباق على الواقعة.</p>';
}
