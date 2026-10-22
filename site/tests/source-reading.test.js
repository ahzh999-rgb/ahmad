import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {checkedInventory} from '../public/source-guard.js';
import {readableFileLink,fileLabel} from '../public/library-core.js';

const sha=x=>createHash('sha256').update(x).digest('hex');
const root=new URL('../public/',import.meta.url);
test('every HTML decision source has a pinned, checksummed reading copy without changing eligibility',async()=>{
 const raw=fs.readFileSync(new URL('library-inventory.json',root),'utf8');
 const manifest=JSON.parse(fs.readFileSync(new URL('source-manifest.json',root),'utf8'));
 const inventory=await checkedInventory(raw,manifest);
 const files=inventory.decisions.flatMap(r=>r.sources).filter(f=>f.format==='html');
 assert.equal(files.length,26);
 for(const file of files){
  assert.equal(file.reading.source_sha256,file.sha256);
  assert.equal(sha(file.reading.text),file.reading.sha256);
  assert.equal(file.reading.answer_eligibility_changed,false);
  assert.ok(file.reading.text.trim().length>20);
 }
 const decree=inventory.decisions.find(r=>r.id==='privatization-decree-63');
 assert.ok(decree.sources[0].reading.text.includes('الموافقة على نظام التخصيص'));
 assert.ok(!decree.sources[0].reading.text.includes('<!DOCTYPE'));
 assert.equal(decree.answer_eligibility_changed,false);
});
test('a substituted or internally inconsistent reading is rejected even if the outer checksum is updated',async()=>{
 const raw=fs.readFileSync(new URL('library-inventory.json',root),'utf8');
 const original=JSON.parse(raw);
 for(const change of [reading=>{reading.text+='altered';},reading=>{reading.source_sha256='0'.repeat(64);},reading=>{reading.answer_eligibility_changed=true;}]){
  const inventory=structuredClone(original),file=inventory.decisions.flatMap(r=>r.sources).find(f=>f.reading);
  change(file.reading);
  const modified=JSON.stringify(inventory);
  const manifest=JSON.parse(fs.readFileSync(new URL('source-manifest.json',root),'utf8'));
  manifest.library_inventory_sha256=sha(modified);
  await assert.rejects(checkedInventory(modified,manifest),/source_integrity/);
 }
});
test('only PDF and images open as files; archived HTML never becomes executable content',()=>{
 const snapshot='a'.repeat(40);
 assert.equal(readableFileLink(snapshot,'sources/test/scan.pdf'),'https://raw.githubusercontent.com/ahzh999-rgb/saudi-legislation/'+snapshot+'/sources/test/scan.pdf');
 assert.ok(readableFileLink(snapshot,'sources/test/page.png'));
 for(const path of ['sources/test/page.html','../scan.pdf','/scan.pdf','sources/a/../scan.pdf','sources/a\\scan.pdf'])assert.equal(readableFileLink(snapshot,path),null);
 assert.equal(readableFileLink('main','sources/test/scan.pdf'),null);
 assert.match(fileLabel({format:'html',path:'sources/test/page.html'}),/HTML/);
});
