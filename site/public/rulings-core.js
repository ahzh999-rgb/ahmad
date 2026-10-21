// Pure helpers for the judicial rulings library (shared by the page and the tests).
import { normalize } from './library-core.js';

export const OUTCOME_ORDER = ['عدم الاختصاص', 'عدم جواز النظر', 'عدم القبول', 'إلغاء القرار', 'رفض الدعوى', 'إلزام الجهة', 'تعويض',
  'انتهاء الخصومة', 'انقطاع الخصومة', 'ترك الخصومة', 'وقف الدعوى', 'قبول الطلب', 'أخرى'];

export function caseLabel(c) {
  const f = c && c.first_instance, a = c && c.appeal;
  if (f) return `القضية ${f.case_no} لعام ${f.year_h}هـ`;
  if (a) return `قضية الاستئناف ${a.case_no} لعام ${a.year_h}هـ`;
  return 'رقم القضية غير مسجل';
}

export function effectText(r) {
  return String(r.effect || '').replace(/^أثر ذلك:?\s*/, '').trim();
}

export function prepare(catalog) {
  const rulings = catalog.rulings.map(r => ({
    ...r,
    searchable: normalize([
      r.id, r.topic.name, ...r.keywords, r.principle, r.effect, ...r.provisions, r.ruling, r.appeal_ruling,
      r.case?.first_instance?.case_no, r.case?.appeal?.case_no, r.case?.session_date_h, r.outcome.first_instance,
    ].filter(Boolean).join(' ')),
  }));
  return { ...catalog, rulings };
}

export function countsBy(rulings, key) {
  const out = new Map();
  for (const r of rulings) { const k = key(r); out.set(k, (out.get(k) || 0) + 1); }
  return out;
}

function terms(query) {
  return normalize(query).match(/[\p{L}\p{N}]+/gu)?.map(t => t.replace(/^ال(?=.{3})/, '')) || [];
}

export function filterRulings(rulings, { q = '', jurisdiction = 'all', collection = 'all', topic = 'all', outcome = 'all' } = {}) {
  const ts = terms(q);
  return rulings.filter(r =>
    (jurisdiction === 'all' || r.jurisdiction === jurisdiction) &&
    (collection === 'all' || r.collection === collection) &&
    (topic === 'all' || `${r.volume}-${r.topic.no}` === topic) &&
    (outcome === 'all' || r.outcome.first_instance === outcome) &&
    ts.every(t => r.searchable.includes(t)));
}

export async function sha256Hex(text) {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function checkedFile(text, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected || '') || await sha256Hex(text) !== expected) throw new Error('source_integrity');
  return text;
}

export function archiveLink(commit, path) {
  if (!/^[a-f0-9]{40}$/.test(commit || '') || !/^sources\/rulings\/[\w-]+\/[\w-]+\.pdf$/.test(path || '')) return null;
  return `https://github.com/ahzh999-rgb/saudi-legislation/blob/${commit}/${path}`;
}

export function officialLink(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'www.bog.gov.sa' ? u.href : null; } catch { return null; }
}
