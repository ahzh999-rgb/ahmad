import { normalize } from './library-core.js';
import { prepare, filterRulings, countsBy, caseLabel, effectText, checkedFile, archiveLink, officialLink, pdfPath, indic } from './rulings-core.js';

const $ = id => document.getElementById(id);
const number = n => new Intl.NumberFormat('en-US').format(n);
let manifest, catalog, textCache = new Map(), serial = 0, catalogScroll = 0;

function el(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = text;
  if (className) e.className = className;
  return e;
}
function bdi(text) { const b = document.createElement('bdi'); b.dir = 'ltr'; b.textContent = text; return b; }
function external(text, href) { const a = el('a', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
function params() { return new URL(location.href).searchParams; }
function urlFor(changes) {
  const u = new URL(location.href);
  for (const [k, v] of Object.entries(changes)) { if (v && v !== 'all') u.searchParams.set(k, v); else u.searchParams.delete(k); }
  return u.pathname + u.search;
}
function navigate(href) { history.pushState(null, '', href); render(true); }

function state() {
  const p = params();
  return { id: p.get('id'), jurisdiction: p.get('j') || 'all', collection: p.get('c') || 'all', topic: p.get('t') || 'all',
           q: p.get('q') || '', full: p.get('full') === '1' };
}

function renderJurisdictions(s) {
  const box = $('jurisdictions'); box.replaceChildren();
  const counts = countsBy(catalog.rulings, r => r.jurisdiction);
  for (const j of [...catalog.jurisdictions].sort((a, b) => a.order - b.order)) {
    const n = counts.get(j.id) || 0;
    const b = el('button', null, 'jurisdiction'); b.type = 'button'; b.setAttribute('role', 'listitem');
    b.setAttribute('aria-pressed', String(s.jurisdiction === j.id));
    b.title = j.current_authority;
    b.append(el('b', j.name), el('span', n ? number(n) + ' حكماً' : 'لا أحكام بعد', 'count'));
    b.disabled = !n;
    b.onclick = () => navigate(urlFor({ j: s.jurisdiction === j.id ? null : j.id, c: null, t: null }));
    box.append(b);
  }
}

function renderFilters(s, inJurisdiction) {
  const col = $('collection'); col.replaceChildren(new Option('جميع المجموعات', 'all'));
  for (const c of catalog.collections.filter(c => s.jurisdiction === 'all' || c.jurisdiction === s.jurisdiction))
    col.append(new Option(`${c.title} (${number(c.ruling_count)})`, c.id));
  col.value = s.collection;
  $('full-text').checked = s.full;
  const chips = $('topics'); chips.replaceChildren();
  const scope = inJurisdiction.filter(r => s.collection === 'all' || r.collection === s.collection);
  const topics = new Map();
  for (const r of scope) { const k = `${r.volume}-${r.topic.no}`; if (!topics.has(k)) topics.set(k, { k, name: r.topic.name, n: 0, v: r.volume, no: r.topic.no }); topics.get(k).n++; }
  const all = el('button', null, 'chip'); all.type = 'button'; all.append('جميع المواضيع', el('span', number(scope.length)));
  all.setAttribute('aria-pressed', String(s.topic === 'all')); all.onclick = () => navigate(urlFor({ t: null })); chips.append(all);
  for (const t of [...topics.values()].sort((a, b) => a.v - b.v || a.no - b.no)) {
    const b = el('button', null, 'chip'); b.type = 'button'; b.append(t.name, el('span', number(t.n)));
    b.setAttribute('aria-pressed', String(s.topic === t.k)); b.onclick = () => navigate(urlFor({ t: s.topic === t.k ? null : t.k }));
    chips.append(b);
  }
}

function card(r) {
  const a = el('a', null, 'card'); a.href = urlFor({ id: r.id });
  a.addEventListener('click', e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); catalogScroll = scrollY; navigate(a.getAttribute('href')); });
  a.append(el('span', `${r.topic.name} · ${r.collection_title}`, 'card-category'));
  a.append(el('h3', r.transcription.subjects));
  const eff = effectText(r); if (eff) a.append(el('p', 'أثر ذلك: ' + eff, 'effect'));
  const bottom = el('div', null, 'card-bottom');
  bottom.append(el('span', caseLabel(r.case) + ' · الجلسة ' + indic(r.case.session_date_h) + 'هـ', 'case'), el('span', 'اقرأ الحكم ←'));
  a.append(bottom);
  return a;
}

function renderCatalog() {
  const s = state();
  $('search').value = s.q;
  const inJ = catalog.rulings.filter(r => s.jurisdiction === 'all' || r.jurisdiction === s.jurisdiction);
  renderJurisdictions(s); renderFilters(s, inJ);
  const rows = filterRulings(catalog.rulings, { ...s, fullText: s.full ? fullTexts : null });
  const box = $('rulings'); box.replaceChildren(...rows.map(card));
  $('result-count').textContent = number(rows.length) + ' من ' + number(catalog.rulings.length) + ' حكماً';
  const jname = catalog.jurisdictions.find(j => j.id === s.jurisdiction)?.name;
  $('result-title').textContent = jname ? 'أحكام ' + jname : 'الأحكام';
  $('empty').hidden = rows.length > 0;
  document.title = 'الأحكام القضائية | المستشار النظامي';
}

function section(parent, title, ...nodes) { parent.append(el('h2', title), ...nodes); }

async function unusedRulingText(r) {
  if (textCache.has(r.id)) return textCache.get(r.id);
  const res = await fetch(`/rulings/text/${r.id}.txt`);
  if (!res.ok) throw new Error('unavailable');
  const text = await checkedFile(await res.text(), r.text_sha256);
  if (manifest.files[`text/${r.id}.txt`] !== r.text_sha256) throw new Error('source_integrity');
  textCache.set(r.id, text); return text;
}

function block(parent, title, ...nodes) {
  const sec = el('section', null, 'ruling-section'); sec.append(el('h2', title, 'source-heading'), ...nodes); parent.append(sec);
}

function renderRuling(r, focus) {
  const t = r.transcription;
  $('ruling-eyebrow').textContent = `${catalog.jurisdictions.find(j => j.id === r.jurisdiction)?.name || ''} · ${r.collection_title}`;
  $('ruling-title').textContent = t.label;
  const badges = $('ruling-badges'); badges.replaceChildren(el('span', caseLabel(r.case), 'badge'));

  const body = $('ruling-body'); body.replaceChildren();
  const head = el('div', null, 'case-header'); for (const line of t.header) head.append(el('p', line)); body.append(head);
  block(body, 'الموضوعات', el('p', t.subjects, 'subjects'), el('p', t.summary));
  if (t.basis.length) { const ul = el('ul', null, 'basis'); for (const b of t.basis) ul.append(el('li', b)); block(body, 'مستند الحكم', ul); }
  block(body, 'منطوق الحكم', el('p', t.ruling));
  if (t.appeal) block(body, 'محكمة الاستئناف', el('p', t.appeal));
  body.append(el('p', 'نُقلت هذه الأجزاء حرفياً من ملف الحكم الرسمي. الوقائع والأسباب في الملف أدناه.', 'muted small'));

  const pdf = pdfPath(r), viewer = $('ruling-pdf'); viewer.replaceChildren();
  if (pdf) {
    const frame = document.createElement('iframe'); frame.src = pdf + '#view=FitH'; frame.title = 'ملف الحكم الرسمي'; frame.loading = 'lazy';
    const actions = el('div', null, 'pdf-actions');
    const dl = el('a', 'تنزيل ملف الحكم (PDF)', 'primary'); dl.href = pdf; dl.download = r.id + '.pdf';
    const open = el('a', 'فتح في نافذة مستقلة', 'quiet'); open.href = pdf; open.target = '_blank'; open.rel = 'noopener';
    actions.append(dl, open);
    viewer.append(el('h2', 'ملف الحكم الرسمي', 'source-heading'), frame, actions);
  }

  const side = $('ruling-side'); side.replaceChildren();
  const dl = el('dl');
  const row = (k, v) => { if (!v) return; dl.append(el('dt', k), el('dd', v)); };
  const f = r.case.first_instance, a = r.case.appeal;
  if (f) row(f.court, indic(`${f.case_no} لعام ${f.year_h}هـ`));
  if (a) row(a.court, indic(`${a.case_no} لعام ${a.year_h}هـ`));
  row('تاريخ الجلسة', indic(r.case.session_date_h) + 'هـ');
  row('الجهة', r.authority);
  row('المجموعة', `${r.collection_title} · المجلد ${indic(r.volume)}`);
  row('الموضوع', r.topic.name);
  if (r.full_volume_page_start) row('الصفحة في المجلد الكامل', indic(r.full_volume_page_start));
  side.append(dl);
  const off = officialLink(r.official_url); if (off) side.append(external('الملف في موقع ديوان المظالم ↗', off));
  const arc = archiveLink(manifest.commit, r.source_path); if (arc) side.append(external('النسخة المؤرشفة ↗', arc));
  document.title = t.label + ' · ' + caseLabel(r.case) + ' | الأحكام القضائية';
  if (focus) { $('ruling-title').focus({ preventScroll: true }); scrollTo(0, 0); }
}

function render(focus = false) {
  const s = state(), r = s.id ? catalog.rulings.find(x => x.id === s.id) : null;
  $('catalog-view').hidden = !!r; $('ruling-view').hidden = !r;
  if (r) renderRuling(r, focus);
  else { renderCatalog(); if (focus && catalogScroll) scrollTo(0, catalogScroll); }
}

async function start() {
  $('load-error').hidden = true; $('load-state').hidden = false; $('catalog-view').hidden = true;
  try {
    const [mr, cr] = await Promise.all([fetch('/rulings/manifest.json'), fetch('/rulings/catalog.json')]);
    if (!mr.ok || !cr.ok) throw new Error('unavailable');
    manifest = await mr.json();
    if (manifest.schema_version !== 1 || manifest.repository !== 'ahzh999-rgb/saudi-legislation' || !/^[a-f0-9]{40}$/.test(manifest.commit || '') || manifest.browse_only !== true)
      throw new Error('source_integrity');
    catalog = prepare(JSON.parse(await checkedFile(await cr.text(), manifest.files['catalog.json'])));
    $('statistics').replaceChildren();
    const stats = [[catalog.rulings.length, 'حكماً'], [catalog.collections.length, 'مجموعة'], [new Set(catalog.rulings.map(r => r.jurisdiction)).size, 'اختصاص']];
    for (const [v, label] of stats) { const s = el('span', null, 'stat'); s.append(el('b', number(v)), el('span', label)); $('statistics').append(s); }
    $('snapshot').replaceChildren(document.createTextNode('نسخة الأرشيف: '), external(manifest.commit.slice(0, 12), 'https://github.com/ahzh999-rgb/saudi-legislation/tree/' + manifest.commit));
    $('load-state').hidden = true;
    render();
  } catch (e) {
    $('load-state').hidden = true; $('load-error').hidden = false;
    $('load-error-message').textContent = e.message === 'source_integrity' ? 'لم تطابق بصمة بيانات الأحكام نسختها المسجلة. أعد تحميل الصفحة.' : 'تحقق من اتصالك ثم أعد المحاولة.';
  }
}

let typing;
$('search').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { history.replaceState(null, '', urlFor({ q: $('search').value.trim() })); renderCatalog(); }, 200); });
$('reset').onclick = $('reset-empty').onclick = () => navigate('/rulings.html');
$('collection').onchange = e => navigate(urlFor({ c: e.target.value, t: null }));
const fullTexts = new Map();
$('full-text').onchange = async e => {
  if (e.target.checked && fullTexts.size < catalog.rulings.length) {
    $('result-count').textContent = 'جارٍ تحميل نصوص البحث…';
    await Promise.all(catalog.rulings.map(async r => {
      try { const res = await fetch(`/rulings/text/${r.id}.txt`); if (res.ok) fullTexts.set(r.id, normalize(await checkedFile(await res.text(), r.text_sha256))); } catch {}
    }));
  }
  navigate(urlFor({ full: e.target.checked ? '1' : null }));
};
$('back').addEventListener('click', e => { e.preventDefault(); navigate(urlFor({ id: null })); });
$('retry').onclick = start;
addEventListener('popstate', () => catalog && render(true));
const root = document.documentElement, isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
try { const t = localStorage.getItem('theme'); if (['light', 'dark'].includes(t)) root.dataset.theme = t; } catch {}
function paintTheme() { $('theme').textContent = isDark() ? 'الوضع الفاتح' : 'الوضع الداكن'; }
paintTheme(); $('theme').onclick = () => { root.dataset.theme = isDark() ? 'light' : 'dark'; try { localStorage.setItem('theme', root.dataset.theme); } catch {} paintTheme(); };
start();
