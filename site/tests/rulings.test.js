import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { prepare, filterRulings, caseLabel, effectText, checkedFile, archiveLink, officialLink } from '../public/rulings-core.js';
const root = new URL('../public/rulings/', import.meta.url);
const raw = fs.readFileSync(new URL('catalog.json', root), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
const catalog = prepare(JSON.parse(raw));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

test('rulings manifest pins every published file and stays browse-only', () => {
  assert.equal(manifest.browse_only, true);
  assert.equal(manifest.displayed_parts, 'REVIEWED_AGAINST_PAGE');
  assert.equal(manifest.full_text, 'search only');
  assert.match(manifest.commit, /^[a-f0-9]{40}$/);
  assert.equal(manifest.ruling_count, catalog.rulings.length);
  for (const [name, digest] of Object.entries(manifest.files)) assert.equal(sha(fs.readFileSync(new URL(name, root))), digest, name);
  for (const r of catalog.rulings) {
    assert.equal(manifest.files[`text/${r.id}.txt`], r.text_sha256, r.id);
    assert.equal(r.transcription.status, 'REVIEWED_AGAINST_PAGE', r.id);
    assert.ok(r.transcription.subjects && r.transcription.summary && r.transcription.ruling, r.id);
  }
});

test('rulings never enter the answer sources', () => {
  const data = fs.readFileSync(new URL('../data.json', root), 'utf8');
  const sm = fs.readFileSync(new URL('../source-manifest.json', root), 'utf8');
  for (const r of catalog.rulings.slice(0, 20)) { assert.ok(!data.includes(r.id)); assert.ok(!sm.includes(r.id)); }
  const worker = fs.readFileSync(new URL('../../src/worker.js', root), 'utf8');
  assert.ok(!/rulings/.test(worker));
});

test('filters combine jurisdiction, topic and normalized text', () => {
  const all = filterRulings(catalog.rulings, {});
  assert.equal(all.length, catalog.rulings.length);
  const contracts = filterRulings(catalog.rulings, { topic: '2-6' });
  assert.ok(contracts.length > 0 && contracts.every(r => r.topic.name === 'عقد'));
  const none = filterRulings(catalog.rulings, { jurisdiction: 'criminal' });
  assert.equal(none.length, 0);
  const r = catalog.rulings[0];
  const byCase = filterRulings(catalog.rulings, { q: r.case.first_instance?.case_no || r.case.appeal.case_no });
  assert.ok(byCase.some(x => x.id === r.id));
  const hamza = filterRulings(catalog.rulings, { q: 'اثر ذلك' });
  assert.ok(hamza.length > 0, 'alef-hamza variants are normalized');
});

test('labels and links are built only from recorded, trusted values', async () => {
  assert.equal(caseLabel({ first_instance: { case_no: '709', year_h: '1443' } }), 'القضية ٧٠٩ لعام ١٤٤٣هـ');
  assert.equal(caseLabel({ appeal: { case_no: '214', year_h: '1444' } }), 'قضية الاستئناف ٢١٤ لعام ١٤٤٤هـ');
  assert.equal(effectText({ transcription: { summary: 'مطالبة – أثر ذلك: عدم قبول الدعوى.' } }), 'عدم قبول الدعوى.');
  assert.equal(officialLink('https://evil.test/x.pdf'), null);
  assert.equal(officialLink('http://www.bog.gov.sa/x.pdf'), null);
  assert.ok(officialLink(catalog.rulings[0].official_url).startsWith('https://www.bog.gov.sa/'));
  assert.equal(archiveLink('bad', 'sources/rulings/x/y.pdf'), null);
  assert.equal(archiveLink('a'.repeat(40), '../etc/passwd'), null);
  await assert.rejects(checkedFile('changed', manifest.files['catalog.json']), /source_integrity/);
  assert.equal(await checkedFile(raw, manifest.files['catalog.json']), raw);
});

test('every displayed part is the publisher\'s own text, with no site-made labels or summaries', () => {
  const allowed = new Set(['label', 'header', 'subjects', 'summary', 'basis', 'ruling', 'appeal', 'status', 'reviewed_against', 'reviewed_on']);
  for (const r of catalog.rulings) {
    assert.deepEqual(Object.keys(r.transcription).filter(k => !allowed.has(k)), [], r.id);
    assert.ok(r.transcription.header.length >= 2, r.id);
    assert.ok(/^(لذلك|حكمت|قررت)/.test(r.transcription.ruling.replace(/^\s+/, '')) || r.transcription.ruling.includes('حكمت') || r.transcription.ruling.includes('قررت'), r.id);
  }
});
