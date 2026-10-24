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
  // boost: لا تُقصي المواد التي لا تحوي اللفظ، بل ترفع ما يحويه وتخصص له موضعاً في الأدلة
  { id:'exceptional_leave', boost:true, query:/اجاز\S*\s+(?:ال)?استثنا/, body:/اجاز\S*\s+(?:ال)?استثنا/ },
  { id:'leave_in_retirement_service', boost:true, query:/^(?=.*اجاز)(?=.*(?:تقاعد|معاش))/, body:/مده الخدمه التي تحسب|مدد الخدمه|لاغراض التقاعد|بدون راتب/ },
  { id:'custody', query:/عهده|عهدته/, body:/عهده|العهد|بعهدته/ },
];
export function domainOf(id) {
  if (/^SA-(LAW|REG)-GTP-|local-content|procurement-|conflicts-of-interest/.test(id)) return 'procurement';
  if (/^civil-service$|^civil-retirement$|^hr-|^discipline-|^public-employees|^talent-/.test(id)) return 'civil';
  if (/^military-retirement$/.test(id)) return 'military';
  if (/^labour-|^maritime-|^agriculture-/.test(id)) return 'labour';
  if (/^privatization-/.test(id)) return 'privatization';
  if (/^public-money-|^budget-instructions/.test(id)) return 'money';
  return 'other';
}
// أسماء النطاقات لعرضها في رسالة «لا أدلة كافية» عندما يكون نطاق السؤال محدداً
export const DOMAIN_LABELS = { procurement:'المنافسات والمشتريات الحكومية', civil:'الخدمة المدنية والموارد البشرية والتقاعد المدني',
  military:'التقاعد العسكري', labour:'نظام العمل', privatization:'التخصيص', money:'المال العام والعهد' };
// العبارات المدنية التي ليست التقاعد المدني (المعاملات المدنية، القانون المدني…) لا تُعدّ تحديداً للفئة
const NON_RETIREMENT_CIVIL = /(?:المعاملات|القانون|الاحوال|الدعوي|القضايا|الحقوق)\s+(?:ال)?مدني\S*/g;
export function routeQuestion(question) {
  const q = normalize(question);
  if (/تخصيص/.test(q)) return 'privatization';
  if (/عهده|عهدته|الاموال العامه/.test(q)) return 'money';
  if (/شراء|منافس|مشتريات/.test(q)) return 'procurement';
  if (/عسكري/.test(q)) return 'military';
  if (/نظام العمل|صاحب العمل|للعامل|العامل|عمال/.test(q)) return 'labour';
  // السائل حدد الفئة صراحة (التقاعد المدني / الخدمة المدنية)، فلا يُسأل «هل تقصد العسكري أم المدني؟».
  // في المحادثة يكفي أن يقول «المدني» جواباً عن سؤال التوضيح: نص البحث يضم سؤال التقاعد السابق إليه.
  if (/الخدمه\s+المدنيه/.test(q) ||
      (/مدني|مدنيين|مدنيه/.test(q.replace(NON_RETIREMENT_CIVIL, '')) && /تقاعد|معاش|عجز/.test(q))) return 'civil';
  if (/موظف|ترقي|اعار|تكليف/.test(q)) return 'civil';
  return null;
}
// ---- المحادثة: نص البحث لسؤال متابعة ----
// سؤال يعتمد على ما قبله: يبدأ بأداة متابعة («وماذا عن…»)، أو قصير جداً بلا موضوع ولا نطاق يخصه («المدني»، «المادة 17؟»)،
// أو يشير إلى سابق («هذه المادة») وهو قصير نسبياً. السؤال المستقل لا يُضم إلى شيء.
const FOLLOW_MARKER = /^(?:(?:و|ف)(?:ماذا|كيف|هل|ما|لماذا|متي|اين|اذا|لو|ان|في)|ماذا عن|اذا|لو)(?=\s|$)/;
// جواب مجرد عن سؤال التوضيح: «المدني»، «العسكري»، «أقصد التقاعد المدني»، «العامل الخاضع لنظام العمل»
const SCOPE_REPLY = /^(?:(?:اقصد|المقصود|اعني)\s+)?(?:(?:ال)?تقاعد\s+)?(?:ال)?(?:عسكري\S*|مدني\S*|عامل\S*|(?:نظام\s+)?العمل|الخاضع\S*\s+لنظام\s+العمل)$/;
const REFERS_BACK = /(?:^|\s)(?:هذا|هذه|ذلك|تلك|نفسه|نفسها|السابقه?|المذكوره?|اعلاه)(?=\s|$)/;
export function dependsOnPrevious(question) {
  const q = normalize(question).trim(), count = words(q).length;
  if (FOLLOW_MARKER.test(q) || SCOPE_REPLY.test(q.replace(/[؟?.!،,\s]+$/u, ''))) return true;
  if (count <= 6 && !routeQuestion(q) && !CONCEPTS.some(c => c.query.test(q))) return true;
  return count <= 10 && REFERS_BACK.test(q);
}
// بلا سجل يعيد السؤال نفسه حرفياً، فلا يتغير سلوك السؤال المفرد.
export function searchQuestion(question, history = []) {
  let text = '';
  for (const q of [...history.filter(m => m.role === 'user').map(m => m.content), question])
    text = text && dependsOnPrevious(q) ? text + '\n' + q : q;
  return text;
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
      key:heading.replace(/^المادة\s*/, ''), domain:domainOf(doc.id), meta:doc.metadata_view, publisher_urls:doc.publisher_urls || [],
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
  const concepts = CONCEPTS.filter(c => c.query.test(q)), required = concepts.filter(c => !c.boost);
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
    if (required.length && !matched.some(c => !c.boost)) continue;
    let score = 0, common = 0;
    for (const term of queryTerms) {
      const tf = row.terms.get(term) || 0;
      if (!tf) continue; common++;
      const df = index.df.get(term) || 0;
      score += Math.log(1+(index.rows.length-df+.5)/(df+.5))*(tf*2.2)/(tf+1.2*(.25+.75*row.length/(index.average || 1)));
    }
    if (!required.length && !matched.length && common < Math.min(2,queryTerms.length || 2)) continue;
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
  // A law and its executive regulation answer the same facet differently: keep the best of each.
  for (const concept of concepts) {
    const seen = new Set(), tops = candidates.filter(r => r.matched.includes(concept.id) && !seen.has(r.instrument) && seen.add(r.instrument));
    for (const row of tops.slice(1,3)) add(row,'concept:'+concept.id);
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
