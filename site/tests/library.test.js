import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCatalog,filterCatalog,matchingArticles,normalize,futureDate,sourceLink,latinDigits,articleLabel,fileLabel,documentType} from '../public/library-core.js';
import {checkedCatalog,checkedSection,checkedInventory} from '../public/source-guard.js';
const root=new URL('../public/',import.meta.url);
const raw=fs.readFileSync(new URL('data.json',root),'utf8');
const data=JSON.parse(raw),manifest=JSON.parse(fs.readFileSync(new URL('source-manifest.json',root),'utf8'));
const docs=buildCatalog(data);

test('library offsets resolve every article to its original eligible section without changing the body',()=>{
 let count=0;
 for(const doc of docs)for(const article of doc.articles){
  const section=JSON.parse(fs.readFileSync(new URL('s/'+article.id+'.json',root),'utf8'));
  assert.equal(section.eligible,true);assert.equal(section.instrument_id,doc.id);
  assert.equal(section.legal_key,article.key);assert.equal(section.b,article.body);count++;
 }
 assert.equal(count,manifest.section_count);assert.equal(docs.length,manifest.document_count);
});
test('Arabic search accepts diacritics and Arabic numbers, with exact article-number matches',()=>{
 const doc=docs.find(d=>d.id==='civil-service');
 assert.equal(normalize('إِعَارَة ٣٢'),'اعاره 32');
 assert.deepEqual(matchingArticles(doc,'المادة ٢٩').map(a=>a.key),['29']);
 assert.deepEqual(matchingArticles(doc,'٢').map(a=>a.key),['2']);
 assert.ok(matchingArticles(doc,'الإعارة').some(a=>a.key==='29'));
});
test('title and body search preserve field filters and report no match honestly',()=>{
 const rows=filterCatalog(docs,{query:'الشراء المباشر',category:'procurement'});
 assert.ok(rows.some(r=>r.doc.id==='SA-LAW-GTP-1440-001'&&r.matches.some(a=>a.key==='32')));
 assert.ok(rows.every(r=>r.doc.category==='procurement'));
 assert.equal(filterCatalog(docs,{query:'عبارةلنيردلهامطابق'}).length,0);
 assert.ok(filterCatalog(docs,{query:'نظام التقاعد العسكري'})[0].titleMatch);
});
test('a document whose title matches the search comes before one that only mentions it in article text',()=>{
 const mk=(id,title,body)=>({id,title,category:'retirement-and-insurance',metadata_view:{},publisher_urls:[],secs:[['المادة (1)',body]]});
 const catalog=buildCatalog({snapshot:'a'.repeat(40),docs:[
  mk('civil-retirement','نظام التقاعد المدني','تسري أحكام نظام التقاعد العسكري على العسكريين'),
  mk('military-retirement','نظام التقاعد العسكري','يسمى هذا النظام نظام التقاعد العسكري')]});
 assert.deepEqual(catalog.map(d=>d.id),['civil-retirement','military-retirement']);
 assert.deepEqual(filterCatalog(catalog,{query:'نظام التقاعد العسكري'}).map(r=>[r.doc.id,r.titleMatch]),
  [['military-retirement',true],['civil-retirement',false]]);
 assert.deepEqual(filterCatalog(catalog,{}).map(r=>r.doc.id),['civil-retirement','military-retirement']);
});
test('partial documents expose only eligible material and do not manufacture missing articles',()=>{
 const doc=docs.find(d=>d.id==='administrative-pleadings-law');
 assert.equal(doc.articles.length,7);assert.equal(matchingArticles(doc,'المادة 4').length,0);
 const hr=docs.find(d=>d.id==='hr-executive');
 assert.equal(hr.articles.length,261);
 assert.ok(matchingArticles(hr,'إجازة استثنائية').some(a=>a.key==='148'));
});
test('a future badge requires a single valid recorded date and verified dimension, never calculated or ambiguous candidates',()=>{
 const doc=docs.find(d=>d.id==='SA-LAW-GTP-1448-001');
 assert.equal(futureDate(doc,'2026-10-20'),'2027-01-02');
 assert.equal(futureDate(doc,'2027-01-02'),null);
 for(const dimension of [
  {dimension_status:'PARTIAL',candidates:[{value:'2027-01-02',kind:'recorded',calendar:'gregorian'}]},
  {dimension_status:'VERIFIED',candidates:[{value:'2027-01-02',kind:'calculated',calendar:'gregorian'}]},
  {dimension_status:'VERIFIED',candidates:[{value:'2027-02-30',kind:'recorded',calendar:'gregorian'}]},
  {dimension_status:'VERIFIED',candidates:['2027-01-02','2028-01-02'].map(value=>({value,kind:'recorded',calendar:'gregorian'}))},
 ])assert.equal(futureDate({metadata_view:{effectiveness:dimension}},'2026-10-20'),null);
});
test('source links are pinned and escaped; untrusted paths cannot escape the source repository',()=>{
 assert.equal(sourceLink(manifest.commit,'sources/نص #1.pdf'),'https://github.com/ahzh999-rgb/saudi-legislation/blob/'+manifest.commit+'/sources/%D9%86%D8%B5%20%231.pdf');
 for(const path of ['../x','/x','a/../x','a\\b','a\n'])assert.equal(sourceLink(manifest.commit,path),null);
 assert.equal(sourceLink('main','file.pdf'),null);
});
test('browser and Worker use the same fail-closed integrity checks',async()=>{
 assert.equal((await checkedCatalog(raw,manifest)).snapshot,data.snapshot);
 await assert.rejects(checkedCatalog(raw+' ',manifest),/source_integrity/);
 const section=fs.readFileSync(new URL('s/0.json',root),'utf8');
 assert.equal((await checkedSection(section,manifest,0)).instrument_id,docs[0].id);
 await assert.rejects(checkedSection(section+' ',manifest,0),/source_integrity/);
});

test('discovery inventory is pinned and cannot be substituted or treated as answer evidence',async()=>{
 const raw=fs.readFileSync(new URL('library-inventory.json',root),'utf8');
 const inventory=await checkedInventory(raw,manifest);
 assert.equal(inventory.snapshot,manifest.commit);assert.equal(inventory.answer_eligibility_changed,false);
 await assert.rejects(checkedInventory(raw+' ',manifest),/source_integrity/);
 assert.equal(inventory.gazette_issues.find(r=>r.id==='4835').archive_kind,'PAGES_OR_WITNESSES');
 assert.ok(!inventory.gazette_issues.some(r=>r.id==='2026'));
});

test('Arabic labels and Latin digits affect presentation only, including repeated article keys',()=>{
 assert.equal(latinDigits('١٢٣ ۴۵۶'),'123 456');
 assert.equal(articleLabel('المادة 15-bis'),'المادة 15 مكرر');
 assert.equal(articleLabel('المادة 37-bis-2'),'المادة 37 مكرر 2');
 assert.equal(fileLabel({path:'sources/gazette/article85-disputed-span.png',format:'png'},'5180'),'مقتطف مصوّر من المادة 85');
 assert.equal(fileLabel({path:'sources/page-5-pdf-10.pdf',format:'pdf'}),'ملف القرار PDF');
 const doc=docs.find(d=>d.id==='civil-service');
 assert.deepEqual(matchingArticles(doc,'المادة ١٥ مكرر').map(a=>a.key),['15-bis']);
 assert.ok(doc.articles.some(a=>a.heading==='المادة 15-bis'));
});
test('document-type filter separates laws, regulations, rules and organizations',()=>{
 for(const type of ['law','regulation','rules','organization']){
  const found=filterCatalog(docs,{type});assert.ok(found.length>0);assert.ok(found.every(r=>documentType(r.doc)===type));
 }
});
test('ordinary question wording finds the governing direct-purchase article',()=>{
 const found=filterCatalog(docs,{query:'ما شروط الشراء المباشر؟',type:'law'});
 const law=found.find(r=>r.doc.id==='SA-LAW-GTP-1440-001');
 assert.ok(law);assert.equal(law.matches[0].key,'32');
});

test('displayTitle separates numbers glued to words for display only',async()=>{
 const {displayTitle}=await import('../public/library-core.js');
 assert.equal(displayTitle('قرار وزير المالية977 بشأن نماذج المشتريات'),'قرار وزير المالية 977 بشأن نماذج المشتريات');
 assert.equal(displayTitle('قرار465 بإضافة الفقرة4 إلى المادة2'),'قرار 465 بإضافة الفقرة 4 إلى المادة 2');
 assert.equal(displayTitle('تعديل قرار العطل532 بالقرار13'),'تعديل قرار العطل 532 بالقرار 13');
 assert.equal(displayTitle('إلغاء المادتين6 و7'),'إلغاء المادتين 6 و7');
 assert.equal(displayTitle('نظام التأمينات الاجتماعية1445هـ وأداة إصداره'),'نظام التأمينات الاجتماعية 1445هـ وأداة إصداره');
 assert.equal(displayTitle('قرار تحديث الجدول — شاهد2025-09'),'قرار تحديث الجدول — شاهد 2025-09');
 assert.equal(displayTitle('مرسوم م/106'),'مرسوم م/106');
 assert.equal(displayTitle('لائحة التأمينات230/تأمينات'),'لائحة التأمينات 230/تأمينات');
 assert.equal(displayTitle('نظام المنافسات والمشتريات الحكومية (1448هـ)'),'نظام المنافسات والمشتريات الحكومية (1448هـ)');
});
