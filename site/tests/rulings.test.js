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
  assert.equal(manifest.verification, 'MACHINE_READ');
  assert.match(manifest.commit, /^[a-f0-9]{40}$/);
  assert.equal(manifest.ruling_count, catalog.rulings.length);
  for (const [name, digest] of Object.entries(manifest.files)) assert.equal(sha(fs.readFileSync(new URL(name, root))), digest, name);
  for (const r of catalog.rulings) {
    assert.equal(manifest.files[`text/${r.id}.txt`], r.text_sha256, r.id);
    assert.equal(r.verification, 'MACHINE_READ');
  }
});

test('rulings never enter the answer sources', () => {
  const data = fs.readFileSync(new URL('../data.json', root), 'utf8');
  const sm = fs.readFileSync(new URL('../source-manifest.json', root), 'utf8');
  for (const r of catalog.rulings.slice(0, 20)) { assert.ok(!data.includes(r.id)); assert.ok(!sm.includes(r.id)); }
  const worker = fs.readFileSync(new URL('../../src/worker.js', root), 'utf8');
  assert.ok(!/rulings/.test(worker));
});

test('filters combine jurisdiction, topic, outcome and normalized text', () => {
  const all = filterRulings(catalog.rulings, {});
  assert.equal(all.length, catalog.rulings.length);
  const contracts = filterRulings(catalog.rulings, { topic: '2-6' });
  assert.ok(contracts.length > 0 && contracts.every(r => r.topic.name === 'عقد'));
  const none = filterRulings(catalog.rulings, { jurisdiction: 'criminal' });
  assert.equal(none.length, 0);
  const r = catalog.rulings[0];
  const byCase = filterRulings(catalog.rulings, { q: r.case.first_instance?.case_no || r.case.appeal.case_no });
  assert.ok(byCase.some(x => x.id === r.id));
  const hamza = filterRulings(catalog.rulings, { q: 'اثر' });
  assert.ok(hamza.length > 0, 'alef-hamza variants are normalized');
});

test('labels and links are built only from recorded, trusted values', async () => {
  assert.equal(caseLabel({ first_instance: { case_no: '709', year_h: '1443' } }), 'القضية 709 لعام 1443هـ');
  assert.equal(caseLabel({ appeal: { case_no: '214', year_h: '1444' } }), 'قضية الاستئناف 214 لعام 1444هـ');
  assert.equal(effectText({ effect: 'أثر ذلك: عدم قبول الدعوى.' }), 'عدم قبول الدعوى.');
  assert.equal(officialLink('https://evil.test/x.pdf'), null);
  assert.equal(officialLink('http://www.bog.gov.sa/x.pdf'), null);
  assert.ok(officialLink(catalog.rulings[0].official_url).startsWith('https://www.bog.gov.sa/'));
  assert.equal(archiveLink('bad', 'sources/rulings/x/y.pdf'), null);
  assert.equal(archiveLink('a'.repeat(40), '../etc/passwd'), null);
  await assert.rejects(checkedFile('changed', manifest.files['catalog.json']), /source_integrity/);
  assert.equal(await checkedFile(raw, manifest.files['catalog.json']), raw);
});
