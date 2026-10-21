import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {referenceLabel,articleLabel,buildCatalog,matchingArticles,referenceUnit} from '../public/library-core.js';
import {sourcesHTML,sourceLinks} from '../public/answer-sources.js';

const id='administrative-execution-executive';
const expected='أحكام اللائحة المرتبطة بالمادة 20 من النظام';
test('regulation groups refer to law articles without inventing independent regulation articles',()=>{
 assert.equal(referenceLabel('المادة group-20',id),expected);
 assert.equal(referenceLabel('group-20',id),expected);
 assert.equal(referenceLabel('المادة 33','SA-LAW-GTP-1440-001'),'المادة 33');
 assert.equal(referenceLabel('المادة 15-bis','civil-service'),'المادة 15 مكرر');
 assert.ok(!referenceLabel('المادة group-20','unrelated-law').includes('المادة 20'));
 assert.ok(!referenceLabel('المادة section-9','unrelated-law').includes('المادة 9'));
 assert.ok(!articleLabel('المادة group-20').includes('group-'));
});
test('all 33 real groups have readable references and keep their immutable keys and bodies',()=>{
 const data=JSON.parse(fs.readFileSync(new URL('../public/data.json',import.meta.url),'utf8'));
 const before=JSON.stringify(data);
 const doc=buildCatalog(data).find(d=>d.id===id);
 assert.equal(doc.articles.length,33);
 assert.equal(referenceUnit(doc),'مجموعة أحكام');
 for(const article of doc.articles){
  assert.match(article.key,/^group-\d+$/);
  assert.equal(article.displayHeading,'أحكام اللائحة المرتبطة بالمادة '+article.key.slice(6)+' من النظام');
  assert.ok(!article.displayHeading.includes('group-'));
  assert.ok(!article.searchable.includes('group-'));
 }
 assert.equal(JSON.stringify(data),before);
 assert.deepEqual(matchingArticles(doc,'المادة ٢٠').map(a=>a.key),['group-20']);
 assert.deepEqual(matchingArticles(doc,'20 مكرر').map(a=>a.key),[]);
 assert.equal(matchingArticles(doc,'2').length,0);
 const normal=buildCatalog({docs:[{id:'other',title:'نظام',secs:[['المادة group-20','نص']]}]})[0];
 assert.equal(matchingArticles(normal,'20').length,0);
});
test('answer references use the proper group label while existing deep links keep working',()=>{
 const source={instrument_id:id,legal_key:'group-20',heading:'المادة group-20',title:'اللائحة التنفيذية'};
 const html=sourcesHTML([source],'a'.repeat(40));
 assert.ok(html.includes(expected));
 assert.ok(html.includes('عرض الأحكام'));
 assert.ok(!html.includes('>المادة group-20'));
 const link=sourceLinks(source,'a'.repeat(40))[0];
 assert.equal(new URL(link.href,'https://example.test').searchParams.get('article'),'group-20');
});
