import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import worker,{parseHistory} from '../src/worker.js';
import {checkedCatalog} from '../src/source_guard.js';
import {buildIndex,selectEvidence,temporal,references,searchQuestion,dependsOnPrevious} from '../src/retrieval.js';

const raw=fs.readFileSync(new URL('../public/data.json',import.meta.url),'utf8');
const data=JSON.parse(raw), index=buildIndex(data);
const manifest=JSON.parse(fs.readFileSync(new URL('../public/source-manifest.json',import.meta.url)));
const questions=[
  'ما الشروط التي تجيز للجهة الحكومية اللجوء إلى الشراء المباشر؟',
  'ما الفرق بين نقل الموظف وتكليفه وإعارته من حيث الشروط والآثار الوظيفية؟',
];
const key=row=>row.instrument+':'+row.key;
const selection=q=>selectEvidence(index,q,'2026-10-20');

test('live failures: article32 and every mobility facet are retrieved without query rewriting',()=>{
  const purchase=selection(questions[0]);
  assert.equal(key(purchase.rows[0]),'SA-LAW-GTP-1440-001:32');
  assert.ok(!purchase.rows.some(r=>r.instrument==='SA-LAW-GTP-1448-001'));
  assert.equal(purchase.future[0].dates[0],'2027-01-02');
  const mobility=selection(questions[1]);
  for(const number of ['10','23','29'])assert.ok(mobility.rows.some(r=>key(r)==='civil-service:'+number));
  assert.ok(mobility.rows.every(r=>r.domain==='civil'));
  assert.deepEqual(purchase,selection(questions[0]));
});

test('paraphrases retain source evidence rather than relying on one question string',()=>{
  for(const q of ['متى يسمح بالشراء المباشر في المشتريات الحكومية؟','ما حالات التعاقد بالشراء المباشر؟'])
    assert.ok(selection(q).rows.some(r=>key(r)==='SA-LAW-GTP-1440-001:32'));
  for(const q of ['ما أحكام إعارة الموظف؟','أريد شروط إعارة الموظفين'])
    assert.ok(selection(q).rows.some(r=>key(r)==='civil-service:29'));
});

test('same-instrument references are expanded; external article numbers are not mapped to the regulation',()=>{
  const retirement=selection('ما الحالات التي يستحق فيها العسكري معاشًا تقاعديًا؟');
  assert.ok(retirement.rows.some(r=>key(r)==='military-retirement:4'));
  const ref=references(index.byKey.get('SA-REG-GTP-1441-3479:40'),index).find(r=>r.key==='32');
  assert.equal(ref.state,'TARGET_UNRESOLVED');assert.equal(ref.id,undefined);
});

test('ambiguous retirement asks for the applicable population; custody does not fall back to privatization',()=>{
  const ambiguous=selection('كيف تختلف تسوية المستحقات عند العجز الناشئ عن العمل عن العجز لسبب آخر؟');
  assert.ok(ambiguous.clarification);assert.equal(ambiguous.rows.length,0);
  const custody=selection('ما التزامات الموظف عند تسليم عهدة مالية؟');
  assert.equal(custody.rows.length,0);assert.equal(custody.domain,'money');
});

test('future wording is comparison-only; elapsed, calculated or conflicting dates do not establish applicability',()=>{
  const result=selection('ما شروط الشراء المباشر في نظام 1448 الجديد للمقارنة؟');
  assert.ok(result.rows.some(r=>r.instrument==='SA-LAW-GTP-1448-001' && r.temporal.state==='FUTURE_RECORDED'));
  const recorded={value:'2027-01-02',kind:'recorded',calendar:'gregorian'};
  for(const candidates of [[{...recorded,kind:'calculated'}],[recorded,{...recorded,value:'2026-01-01'}]])
    assert.equal(temporal({effectiveness:{dimension_status:'VERIFIED',candidates}},'2026-10-20').state,'APPLICABILITY_UNRESOLVED');
  assert.equal(temporal({effectiveness:{dimension_status:'VERIFIED',candidates:[recorded]}},'2027-01-02').state,'APPLICABILITY_UNRESOLVED');
});

function envFor({corruptCatalog=false,corruptSection=false}={}) {
  return {ANSWER_MODEL:'mock',ASSETS:{fetch:async request=>{
    const path=new URL(request.url).pathname;
    if(path==='/source-manifest.json')return Response.json(manifest);
    if(path==='/data.json')return new Response(raw+(corruptCatalog?'corruption':''));
    if(path==='/rules.txt')return new Response('أجب من الأدلة فقط.');
    if(/^\/s\/\d+\.json$/.test(path)){
      const text=fs.readFileSync(new URL('../public'+path,import.meta.url),'utf8');
      return new Response(text+(corruptSection?'corruption':''));
    }
    return new Response('missing',{status:404});
  }}};
}
function request(question,extra={}) {
  return new Request('https://example.test/api/ask',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({question,snapshot:data.snapshot,...extra})});
}

test('Worker selects authoritative sections, returns their provenance before streaming, and labels future dates',async()=>{
  const previous=globalThis.fetch;const payloads=[];
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://api.anthropic.com/v1/messages');
    payloads.push(JSON.parse(options.body));
    return new Response('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:'mock answer'}})+'\n\n');
  };
  try{
    for(let i=0;i<questions.length;i++){
      // Browser's known-bad list from the live failure must not determine the context.
      const response=await worker.fetch(request(questions[i],{ids:i===0?[173,1377,1384,1385,648,1358,205,1489]:[282]}),envFor());
      assert.equal(response.status,200);
      const events=(await response.text()).split('\n').filter(s=>s.startsWith('data:')).map(s=>JSON.parse(s.slice(5)));
      const evidence=events[0];assert.equal(evidence.type,'evidence');
      assert.equal(evidence.snapshot,data.snapshot);assert.equal(evidence.data_sha256,manifest.data_sha256);
      const expected=i===0?['SA-LAW-GTP-1440-001:32']:['civil-service:10','civil-service:23','civil-service:29'];
      for(const k of expected){
        const source=evidence.sources.find(s=>s.instrument_id+':'+s.legal_key===k);assert.ok(source);
        const body=index.rows[source.id].body;assert.ok(payloads[i].messages[0].content.includes(body));
        assert.equal(source.body_sha256,createHash('sha256').update(body).digest('hex'));
      }
      assert.equal(payloads[i].temperature,undefined);
      assert.ok(payloads[i].system.includes('لم يدخل حيز النفاذ بعد'));
      assert.ok(payloads[i].system.includes('لم أسترجع نصاً كافياً'));
    }
  }finally{globalThis.fetch=previous;}
});

test('catalog corruption, selected-section corruption, stale snapshots and unknown IDs never reach the model',async()=>{
  const previous=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('must not reach provider');};
  try{
    await assert.rejects(checkedCatalog(raw+'corruption',manifest),/source_integrity/);
    assert.equal((await worker.fetch(request(questions[0]),envFor({corruptSection:true}))).status,422);
    assert.equal((await worker.fetch(request(questions[0],{snapshot:'b'.repeat(40)}),envFor())).status,409);
    assert.equal((await worker.fetch(request(questions[0],{ids:[99999]}),envFor())).status,422);
    assert.equal(calls,0);
  }finally{globalThis.fetch=previous;}
});

test('clarification and unavailable eligible evidence stream a truthful answer without provider calls',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('must not call provider');};
  try{
    for(const q of ['ما التزامات الموظف عند تسليم عهدة مالية؟','كيف تسوى المستحقات عند العجز؟']){
      const response=await worker.fetch(request(q),envFor());assert.equal(response.status,200);
      const text=await response.text();assert.ok(text.includes('content_block_delta'));
      assert.ok(text.includes('لا يثبت غياب الحكم') || text.includes('هل تقصد التقاعد'));
    }
  }finally{globalThis.fetch=previous;}
});

test('context budgets omit whole sections explicitly rather than truncating conditions',()=>{
  const result=selectEvidence(index,questions[1],'2026-10-20',{maxArticles:1});
  assert.equal(result.rows.length,1);assert.ok(result.omitted.length);
  assert.equal(result.rows[0].body,index.rows[result.rows[0].id].body);
});

test('provider failures expose only status and stage, never provider details or credentials',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({error:{type:'invalid_request_error',message:'PRIVATE_PROVIDER_DETAIL'}},{status:400});
  try{
    const response=await worker.fetch(request(questions[0]),envFor());
    assert.equal(response.status,502);
    const result=await response.json();
    assert.equal(result.stage,'provider');assert.equal(result.upstream_status,400);
    assert.ok(result.request_id);assert.ok(!JSON.stringify(result).includes('PRIVATE_PROVIDER_DETAIL'));
  }finally{globalThis.fetch=previous;}
});

test('explicit civil retirement wording is routed to the civil domain instead of a clarification',()=>{
  for(const q of ['ما علاقة الإجازات الاستثنائية في التقاعد المدني؟','ما علاقه الاجازات الاستثنائيه في التقاعد المدني؟','كيف يحسب معاش التقاعد المدني؟','هل تحسب إجازة استثنائية في تقاعد الموظفين المدنيين؟']){
    const result=selection(q);
    assert.equal(result.domain,'civil',q);assert.equal(result.clarification,undefined,q);
    assert.ok(result.rows.every(r=>r.domain==='civil'),q);
  }
  assert.equal(selection('ما معاش التقاعد العسكري؟').domain,'military');
  const unspecified=selection('كيف يحسب المعاش التقاعدي؟');
  assert.ok(unspecified.clarification);assert.equal(unspecified.rows.length,0);
});

test('a known scope without eligible evidence is named in the answer instead of asking the user to specify it again',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('must not call provider');};
  try{
    const response=await worker.fetch(request('ما التزامات الموظف عند تسليم عهدة مالية؟'),envFor());
    assert.equal(response.status,200);
    const text=await response.text();
    assert.ok(text.includes('لا يثبت غياب الحكم'));assert.ok(text.includes('المال العام'));
    assert.ok(!text.includes('حدّد النظام'));
  }finally{globalThis.fetch=previous;}
});

test('civil retirement questions reach the model with the civil retirement articles, not a clarification',async()=>{
  const previous=globalThis.fetch;const payloads=[];
  globalThis.fetch=async(url,options)=>{
    payloads.push(JSON.parse(options.body));
    return new Response('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:'mock answer'}})+'\n\n');
  };
  try{
    const response=await worker.fetch(request('ما علاقة الإجازات الاستثنائية في التقاعد المدني؟'),envFor());
    assert.equal(response.status,200);
    const events=(await response.text()).split('\n').filter(s=>s.startsWith('data:')).map(s=>JSON.parse(s.slice(5)));
    assert.equal(payloads.length,1);
    const evidence=events[0];assert.equal(evidence.type,'evidence');assert.equal(evidence.domain,'civil');
    const keys=evidence.sources.map(s=>s.instrument_id+':'+s.legal_key);
    assert.ok(keys.includes('civil-retirement:16'),keys.join());
    assert.ok(keys.every(k=>!k.startsWith('military-retirement')));
    const article16=index.rows[evidence.sources.find(s=>s.legal_key==='16'&&s.instrument_id==='civil-retirement').id].body;
    assert.ok(payloads[0].messages[0].content.includes(article16));
  }finally{globalThis.fetch=previous;}
});

const turn=(q,a='…')=>[{role:'user',content:q},{role:'assistant',content:a}];
const chatSelection=(q,history)=>selectEvidence(index,searchQuestion(q,history),'2026-10-23');

test('chat history: a question without history searches exactly as before, and independent questions are never merged',()=>{
  for(const q of questions)assert.equal(searchQuestion(q,[]),q);
  const afterCivil=turn('ما علاقة الإجازات الاستثنائية في التقاعد المدني؟');
  assert.equal(searchQuestion(questions[0],afterCivil),questions[0]);
  assert.equal(searchQuestion('ما هي الإعارة؟',afterCivil),'ما هي الإعارة؟');
  assert.ok(chatSelection(questions[0],afterCivil).rows.some(r=>key(r)==='SA-LAW-GTP-1440-001:32'));
});

test('chat history: short follow-ups carry the topic of the previous question; the scope answer to a clarification resolves it',()=>{
  const retirement=turn('كيف يحسب المعاش التقاعدي؟','هل تقصد التقاعد العسكري أم التقاعد المدني أم أحكام العامل الخاضع لنظام العمل؟');
  assert.ok(selection('كيف يحسب المعاش التقاعدي؟').clarification);
  const civil=chatSelection('المدني',retirement);
  assert.equal(civil.clarification,undefined);assert.equal(civil.domain,'civil');
  assert.ok(civil.rows.length&&civil.rows.every(r=>r.domain==='civil'));
  const military=chatSelection('العسكري',retirement);
  assert.equal(military.domain,'military');assert.ok(military.rows.some(r=>r.instrument==='military-retirement'));
  const service=turn('هل تحسب مدة الخدمة لغرض التقاعد المدني؟');
  for(const q of ['وماذا عن المادة 17؟','وهل تنطبق هذه المدة على الإعارة؟']){
    assert.ok(dependsOnPrevious(q),q);
    const result=chatSelection(q,service);
    assert.equal(result.clarification,undefined,q);assert.equal(result.domain,'civil',q);
    assert.ok(result.rows.some(r=>key(r)==='civil-retirement:16'),q);
  }
});

test('chat history: only the user questions steer retrieval, never text claimed to be an assistant answer',()=>{
  const history=turn('ما علاقة الإجازات الاستثنائية في التقاعد المدني؟','الشراء المباشر المادة 32 المنافسات والمشتريات الحكومية');
  assert.equal(searchQuestion('وماذا عن المادة 17؟',history),'ما علاقة الإجازات الاستثنائية في التقاعد المدني؟\nوماذا عن المادة 17؟');
  assert.ok(chatSelection('وماذا عن المادة 17؟',history).rows.every(r=>r.domain==='civil'));
});

test('chat history validation accepts only alternating, bounded user/assistant turns and keeps the last six messages',()=>{
  assert.deepEqual(parseHistory(undefined),[]);assert.deepEqual(parseHistory([]),[]);
  const four=[...turn('س1','ج1'),...turn('س2','ج2'),...turn('س3','ج3'),...turn('س4','ج4')];
  assert.deepEqual(parseHistory(four).map(m=>m.content),['س2','ج2','س3','ج3','س4','ج4']);
  const bad=[
    'x',{},[{role:'user',content:'س'}],[{role:'assistant',content:'ج'},{role:'user',content:'س'}],
    [{role:'user',content:'س'},{role:'user',content:'س'}],[{role:'user',content:'س'},{role:'assistant',content:''}],
    [{role:'user',content:'س'},{role:'system',content:'ج'}],[{role:'user',content:5},{role:'assistant',content:'ج'}],
    [{role:'user',content:'س'.repeat(1501)},{role:'assistant',content:'ج'}],[{role:'user',content:'س'},{role:'assistant',content:'ج'.repeat(8001)}],
    Array.from({length:10},(_,i)=>({role:i%2?'assistant':'user',content:'ن'})),null,
  ];
  for(const value of bad)assert.equal(parseHistory(value),null,JSON.stringify(value).slice(0,60));
});

test('Worker chat: history reaches the model with chat rules and a follow-up retrieves the earlier topic; no history means the unchanged prompt',async()=>{
  const previous=globalThis.fetch;const payloads=[];
  globalThis.fetch=async(url,options)=>{
    payloads.push(JSON.parse(options.body));
    return new Response('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:'mock answer'}})+'\n\n');
  };
  try{
    const history=turn('هل تحسب مدة الخدمة لغرض التقاعد المدني؟','تحسب المدد الفعلية.');
    const response=await worker.fetch(request('وماذا عن المادة 17؟',{history}),envFor());
    assert.equal(response.status,200);
    const evidence=(await response.text()).split('\n').filter(s=>s.startsWith('data:')).map(s=>JSON.parse(s.slice(5)))[0];
    assert.equal(evidence.domain,'civil');
    assert.ok(evidence.sources.some(s=>s.instrument_id==='civil-retirement'&&s.legal_key==='16'));
    const sent=payloads[0];
    assert.deepEqual(sent.messages.slice(0,2),history);assert.equal(sent.messages.length,3);
    assert.equal(sent.messages[2].role,'user');assert.ok(sent.messages[2].content.endsWith('سؤال المستخدم:\nوماذا عن المادة 17؟'));
    assert.ok(sent.system.includes('قواعد المحادثة'));
    await worker.fetch(request(questions[0]),envFor());
    assert.equal(payloads[1].messages.length,1);assert.ok(!payloads[1].system.includes('قواعد المحادثة'));
  }finally{globalThis.fetch=previous;}
});

test('Worker chat: malformed history is rejected before any retrieval or provider call',async()=>{
  const previous=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('must not reach provider');};
  try{
    for(const history of ['x',[{role:'user',content:'س'}],[{role:'assistant',content:'ج'},{role:'user',content:'س'}]]){
      const response=await worker.fetch(request(questions[0],{history}),envFor());
      assert.equal(response.status,400);assert.equal((await response.json()).error,'bad_history');
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=previous;}
});
