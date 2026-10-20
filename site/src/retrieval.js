// Deterministic evidence retrieval. Lexical rules are search aids, not legal findings.
export const RETRIEVAL_VERSION = 'server-evidence-v1';
const STOP = new Set('ما هي هو هل كيف متى التي الذي في من على الى عن مع او ان هذا هذه ذلك بين حيث يجوز تجيز الشروط شروط الحالات حالات الضوابط المنظمه الاثار المترتبه'.split(' '));
export function normalize(s) {
  return String(s || '').normalize('NFKC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ\u200e\u200f]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).toLowerCase();
}
function words(s) { return normalize(s).match(/[\p{L}\p{N}]+/gu) || []; }
function stem(w) {
  return w.replace(/^(?:وال|بال|كال|فال|لل|ال)/, '').replace(/^[وف](?=.{4})/, '').replace(/(?:اته|ها|ته|ات|ون|ين|ه)$/, '');
}
const CONCEPTS = [
  { id:'direct_purchase', query:/الشراء المباشر|شراء مباشر/, body:/الشراء المباشر|شراء مباشر/ },
  { id:'cancellation', query:/الغاء المنافس|تلغ.*المنافس/, body:/الغاء المنافس|تلغ.*المنافس|الغائها/ },
  { id:'promotion', query:/ترقي/, body:/ترقي|المرقي|يرقي/ },
  { id:'transfer', query:/نقل الموظف|نقله/, body:/نقل|ينقل|المنقول/ },
  { id:'assignment', query:/تكليف/, body:/تكليف/ },
  { id:'secondment', query:/اعار/, body:/اعار|المعار/ },
  { id:'pension', query:/معاش/, body:/معاش/ },
  { id:'disability', query:/عجز/, body:/عجز|لياق.{0,20}طبي/ },
  { id:'service', query:/مده الخدمه|المدد المستبعد/, body:/مده الخدمه|مده خدمته|لاغراض التقاعد|مدد الخدمه/ },
  { id:'worker_leaving', query:/ترك العمل|دون اشعار/, body:/يترك العمل دون اشعار|ترك العمل دون اشعار/ },
  { id:'custody', query:/عهده|عهدته/, body:/عهده|العهد|بعهدته/ },
];
export function domainOf(id) {
  if (/^SA-(LAW|REG)-GTP-|local-content|procurement-|conflicts-of-interest/.test(id)) return 'procurement';
  if (/^civil-service$|^hr-|^discipline-|^public-employees|^talent-/.test(id)) return 'civil';
  if (/^military-retirement$/.test(id)) return 'military';
  if (/^labour-|^maritime-|^agriculture-/.test(id)) return 'labour';
  if (/^privatization-/.test(id)) return 'privatization';
  if (/^public-money-|^budget-instructions/.test(id)) return 'money';
  return 'other';
}
export function routeQuestion(question) {
  const q = normalize(question);
  if (/تخصيص/.test(q)) return 'privatization';
  if (/عهده|عهدته|الاموال العامه/.test(q)) return 'money';
  if (/شراء|منافس|مشتريات/.test(q)) return 'procurement';
  if (/عسكري/.test(q)) return 'military';
  if (/نظام العمل|صاحب العمل|للعامل|العامل|عمال/.test(q)) return 'labour';
  if (/موظف|ترقي|اعار|تكليف/.test(q)) return 'civil';
  return null;
}
function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function temporal(meta, day) {
  if (!validDay(day)) throw new Error('invalid_date');
  const dimension = meta?.effectiveness || {};
  const dates = [...new Set((dimension.candidates || []).filter(c => c.kind === 'recorded' &&
    ['gregorian','unspecified'].includes(c.calendar) && validDay(c.value) && Number(c.value.slice(0,4)) >= 1700).map(c => c.value))];
  return { state:dimension.dimension_status === 'VERIFIED' && dates.length === 1 && dates[0] > day ?
    'FUTURE_RECORDED' : 'APPLICABILITY_UNRESOLVED', dates, as_of:day,
    point_in_time_applicability_established:false };
}
export function buildIndex(data) {
  const rows = [], df = new Map();
  for (const doc of data.docs) for (const [heading, body] of doc.secs) {
    const terms = new Map();
    for (const token of words(body).map(stem)) if (token.length > 1) terms.set(token, (terms.get(token) || 0) + 1);
    const row = { id:rows.length, instrument:doc.id, title:doc.title, heading, body,
      key:heading.replace(/^المادة\s*/, ''), domain:domainOf(doc.id), meta:doc.metadata_view,
      normalized:normalize(body), terms, length:[...terms.values()].reduce((a,b) => a+b, 0) };
    for (const token of terms.keys()) df.set(token, (df.get(token) || 0) + 1);
    rows.push(row);
  }
  return { rows, df, average:rows.reduce((n,r) => n+r.length, 0) / (rows.length || 1),
    byKey:new Map(rows.map(r => [r.instrument + ':' + r.key, r])) };
}
// Numeric/ordinal references through 99. Cross-instrument references are not guessed.
const ordinals = new Map();
const units = ['الحاديه','الثانيه','الثالثه','الرابعه','الخامسه','السادسه','السابعه','الثامنه','التاسعه'];
['الاولي',...units.slice(1),'العاشره'].forEach((s,i) => ordinals.set(s, i+1));
units.forEach((s,i) => ordinals.set(s+' عشره',i+11));
['العشرين','الثلاثين','الاربعين','الخمسين','الستين','السبعين','الثمانين','التسعين'].forEach((s,i) => {
  for (const form of [s,s.replace(/ين$/, 'ون')]) {
    ordinals.set(form,20+i*10);units.forEach((u,j) => ordinals.set(u+' و'+form,21+i*10+j));
  }
});
const ordinalPattern = [...ordinals.keys()].sort((a,b) => b.length-a.length).map(x => x.replace(/ /g,'\\s*')).join('|');
const referencesPattern = new RegExp('الماده\\s*(?:[（(]\\s*(\\d+|'+ordinalPattern+')\\s*[)）]|(\\d+|'+ordinalPattern+')(?![ء-ي0-9]))','g');
export function references(row, index) {
  const found = new Map();
  for (const match of row.normalized.matchAll(referencesPattern)) {
    const raw = match[1] || match[2];
    const key = /^\d+$/.test(raw) ? String(Number(raw)) : String([...ordinals].find(([s]) => s.replace(/\s/g,'') === raw.replace(/\s/g,''))?.[1]);
    if (key === row.key) continue;
    const tail = row.normalized.slice(match.index + match[0].length);
    if (/^\s*من\s+(?:النظام|اللايحه|اللائحه|نظام|لايحه|لائحه)/.test(tail)) {
      found.set('external:'+key, { key, state:'TARGET_UNRESOLVED' });continue;
    }
    const target = index.byKey.get(row.instrument+':'+key);
    found.set(key, { key, state:target ? 'CANDIDATE_FOUND' : 'NOT_INDEXED', id:target?.id });
  }
  return [...found.values()];
}
export function selectEvidence(index, question, day, { maxArticles=12, maxBodyChars=30000 } = {}) {
  const q = normalize(question), domain = routeQuestion(question);
  const concepts = CONCEPTS.filter(c => c.query.test(q));
  const queryTerms = [...new Set(words(question).filter(t => !STOP.has(t)).map(stem))];
  const comparison = /1448|م\s*\/\s*76|النظام الجديد|النظامين|مقارنه/.test(q);
  if (!domain && /عجز|معاش|التقاعد/.test(q)) return { rows:[], domain,
    clarification:'هل تقصد التقاعد العسكري أم التقاعد المدني أم أحكام العامل الخاضع لنظام العمل؟', day, concepts:concepts.map(c => c.id), future:[], omitted:[], references:[] };
  const future = new Map(), candidates = [];
  for (const row of index.rows) {
    if (domain && row.domain !== domain) continue;
    const dates = temporal(row.meta, day);
    if (dates.state === 'FUTURE_RECORDED' && !comparison) {
      future.set(row.instrument,{title:row.title,...dates});continue;
    }
    const matched = concepts.filter(c => c.body.test(row.normalized));
    if (concepts.length && !matched.length) continue;
    let score = 0, common = 0;
    for (const term of queryTerms) {
      const tf = row.terms.get(term) || 0;
      if (!tf) continue; common++;
      const df = index.df.get(term) || 0;
      score += Math.log(1+(index.rows.length-df+.5)/(df+.5))*(tf*2.2)/(tf+1.2*(.25+.75*row.length/(index.average || 1)));
    }
    if (!concepts.length && common < Math.min(2,queryTerms.length || 2)) continue;
    score += matched.length * 30;
    score += matched.filter(c => c.body.test(row.normalized.slice(0,100))).length * 12;
    if (row.title.startsWith('نظام') && /شروط|الشروط|حالات|الحالات|يجوز|تجيز/.test(q)) score += 15;
    if (/في الحالات|الحالات الاتيه/.test(row.normalized.slice(0,200))) score += 8;
    candidates.push({...row, score, matched:matched.map(c => c.id), temporal:dates});
  }
  candidates.sort((a,b) => b.score-a.score || a.id-b.id);
  const selected = new Map(), omitted = [], linked = [];
  let chars = 0;
  function add(row, reason) {
    if (selected.has(row.id)) return;
    if (row.body.length > maxBodyChars && !selected.size) throw new Error('context_too_large');
    if (selected.size >= maxArticles || chars+row.body.length > maxBodyChars) { omitted.push(row.id);return; }
    selected.set(row.id,{...row, reason});chars += row.body.length;
  }
  // Each requested facet gets evidence before general top results consume the budget.
  for (const concept of concepts) {
    const top = candidates.find(r => r.matched.includes(concept.id));
    if (top) add(top,'concept:'+concept.id);
  }
  for (const row of candidates.slice(0,6)) add(row,'ranked');
  for (const row of [...selected.values()]) for (const ref of references(row,index)) {
    linked.push({from:row.id,...ref});
    if (ref.id === undefined) continue;
    const target = index.rows[ref.id];
    const dates = temporal(target.meta,day);
    if (dates.state !== 'FUTURE_RECORDED' || comparison) add({...target,temporal:dates},'reference:'+row.id);
  }
  return { rows:[...selected.values()], domain, day, concepts:concepts.map(c => c.id),
    future:[...future.values()], references:linked, omitted:[...new Set(omitted)],
    coverage:'eligible_indexed_articles_only', currentness_or_applicability_established:false };
}
