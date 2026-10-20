import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from '../src/worker.js';
import { checkedSection } from '../src/source_guard.js';
const sha = x => createHash('sha256').update(x).digest('hex');
const snapshot = 'a'.repeat(40);
function fixtures(kind = 'OFFICIAL_SNAPSHOT', body = 'نص المادة كاملاً مع الاستثناء.') {
  const section = { eligible: true, body_kind: kind, snapshot, instrument_id:'test-law',legal_key:'1',t: 'نظام', m: {}, h: 'المادة 1', b: body, body_sha256: sha(body), verification_summary: {}, metadata_view: {}, source_url: 'https://github.com/source', version_scope: 'snapshot' };
  const raw = JSON.stringify(section) + '\n';
  const data=JSON.stringify({snapshot,repository:'ahzh999-rgb/saudi-legislation',docs:[{id:'test-law',title:'نظام',metadata_view:{},secs:[['المادة 1',body]]}]});
  const manifest = { schema_version: 1, repository: 'ahzh999-rgb/saudi-legislation', commit: snapshot, section_sha256: { 0: sha(raw) },data_sha256:sha(data),document_count:1,section_count:1 };
  return { section, raw, manifest, data };
}
function envFor(f) {
  return { ASSETS: { fetch: async req => {
    const p = new URL(req.url).pathname;
    if (p === '/source-manifest.json') return Response.json(f.manifest);
    if (p === '/rules.txt') return new Response('قواعد الإجابة');
    if (p === '/data.json') return new Response(f.data);
    if (p === '/s/0.json') return new Response(f.raw);
    return new Response('missing', { status: 404 });
  } }, ANSWER_MODEL: 'mock' };
}
const request = (body = {}) => new Request('https://example.test/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'ما حكم نص المادة؟', ids: [0], snapshot, ...body }) });

test('source integrity and raw-kind rejection also hold server side', async () => {
  let f = fixtures();
  assert.equal((await checkedSection(f.raw, f.manifest, 0)).b, f.section.b);
  await assert.rejects(checkedSection(f.raw + ' ', f.manifest, 0), /source_integrity/);
  f = fixtures('RAW_WITNESS');
  await assert.rejects(checkedSection(f.raw, f.manifest, 0), /ineligible_source/);
});

test('old browser snapshot and unknown section cannot reach the model', async () => {
  let res = await worker.fetch(request({ snapshot: 'b'.repeat(40) }), envFor(fixtures()));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'source_snapshot_changed');
  res = await worker.fetch(request({ ids: [99] }), envFor(fixtures()));
  assert.equal(res.status, 422);
});

test('oversized context fails rather than truncating a qualification', async () => {
  const res = await worker.fetch(request(), envFor(fixtures('OWNER_ACCEPTED', 'نص المادة '+'ن'.repeat(30001))));
  assert.equal(res.status, 413);
});

test('model receives full article and evidence limits, never client supplied body', async () => {
  const body = 'نص المادة '+'ن'.repeat(2700) + ' إلا في حالة الاستثناء الأخير.';
  const f = fixtures('OWNER_ACCEPTED', body);let called = false;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    called = true;
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    const payload = JSON.parse(options.body);
    assert.ok(payload.messages[0].content.includes(body));
    assert.ok(!payload.messages[0].content.includes('CLIENT_UNTRUSTED_BODY'));
    assert.ok(payload.system.includes('لا تحسم السريان'));
    return new Response('data: mock\n\n');
  };
  try {
    const res = await worker.fetch(request({ body: 'CLIENT_UNTRUSTED_BODY' }), envFor(f));
    assert.equal(res.status, 200);assert.equal(called, true);
  } finally { globalThis.fetch = oldFetch; }
});
