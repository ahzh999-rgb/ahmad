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

test('evidence links come from the checked catalog, ignoring client supplied publishers',async()=>{
  const f=fixtures();
  const data=JSON.parse(f.data);
  data.docs[0].publisher_urls=['https://www.uqn.gov.sa/details?p=18244','https://uqn.gov.sa.evil.test/'];
  f.data=JSON.stringify(data);f.manifest.data_sha256=sha(f.data);
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response('data: mock\n\n');
  try {
    const response=await worker.fetch(request({publisher_urls:['https://www.uqn.gov.sa/wrong']}),envFor(f));
    assert.equal(response.status,200);
    const events=(await response.text()).split('\n').filter(l=>l.startsWith('data: '));
    const evidence=events.map(l=>{try{return JSON.parse(l.slice(6));}catch{return null;}}).find(e=>e?.type==='evidence');
    assert.equal(evidence.sources[0].instrument_id,'test-law');
    assert.equal(evidence.sources[0].legal_key,'1');
    assert.equal(evidence.sources[0].source_url,f.section.source_url);
    assert.deepEqual(evidence.sources[0].publisher_urls,['https://www.uqn.gov.sa/details?p=18244']);
  } finally {globalThis.fetch=oldFetch;}
});

test('group keys stay internal while model context and SSE headings describe the real source structure',async()=>{
 const body='20/1- نص المادة وأحكام الغرامة التهديدية.\n20/2- بقية أحكام اللائحة.';
 const f=fixtures('OFFICIAL_SNAPSHOT',body);
 const id='administrative-execution-executive',heading='المادة group-20';
 Object.assign(f.section,{instrument_id:id,legal_key:'group-20',h:heading});
 f.raw=JSON.stringify(f.section)+'\n';f.manifest.section_sha256[0]=sha(f.raw);
 const data=JSON.parse(f.data);data.docs[0].id=id;data.docs[0].secs[0][0]=heading;
 f.data=JSON.stringify(data);f.manifest.data_sha256=sha(f.data);
 const oldFetch=globalThis.fetch;
 let called=false;
 globalThis.fetch=async(url,options)=>{
  called=true;const payload=JSON.parse(options.body);
  assert.ok(payload.messages[0].content.includes('أحكام اللائحة المرتبطة بالمادة 20 من النظام'));
  assert.ok(payload.messages[0].content.includes(body));
  assert.ok(!payload.messages[0].content.includes('group-20'));
  assert.ok(payload.system.includes('ليس مادة مستقلة في اللائحة'));
  return new Response('data: mock\n\n');
 };
 try{
  const response=await worker.fetch(request(),envFor(f));
  assert.equal(response.status,200);assert.ok(called);
  const first=(await response.text()).split('\n').find(l=>l.startsWith('data: '));
  const source=JSON.parse(first.slice(6)).sources[0];
  assert.equal(source.legal_key,'group-20');
  assert.equal(source.heading,'أحكام اللائحة المرتبطة بالمادة 20 من النظام');
  assert.equal(source.body_sha256,sha(body));
 }finally{globalThis.fetch=oldFetch;}
});
