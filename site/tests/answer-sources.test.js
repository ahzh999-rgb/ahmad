import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceLinks, sourcesHTML, publisherLink} from '../public/answer-sources.js';

const snapshot='a'.repeat(40);
const source={instrument_id:'test-law',legal_key:'10-bis-2',title:'نظام تجريبي',heading:'المادة 10-bis-2',
  source_url:'https://github.com/ahzh999-rgb/saudi-legislation/blob/'+snapshot+'/sources/test/نسخة.pdf',
  publisher_urls:['https://www.uqn.gov.sa/details?p=18244','https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/example/1']};

test('article, pinned archive and recorded official publisher links remain distinct',()=>{
  const links=sourceLinks(source,snapshot);
  assert.equal(links.length,4);
  const article=new URL(links[0].href,'https://example.test');
  assert.equal(article.pathname,'/library');
  assert.equal(article.searchParams.get('doc'),'test-law');
  assert.equal(article.searchParams.get('article'),'10-bis-2');
  assert.ok(links[1].href.includes('raw.githubusercontent.com/ahzh999-rgb/saudi-legislation/'+snapshot+'/sources/test/'));
  assert.match(links[1].label,/ملف المصدر المستخدم/);
  assert.match(links[2].label,/أم القرى/);
  assert.match(links[3].label,/هيئة الخبراء/);
});

test('old evidence still links the material and archive without inventing an official URL',()=>{
  const {publisher_urls,...legacy}=source;
  assert.deepEqual(sourceLinks(legacy,snapshot).map(l=>l.kind),['article','archive']);
  assert.ok(!sourcesHTML([legacy],snapshot).includes('المصدر الرسمي'));
  assert.equal(sourcesHTML([],snapshot),'');
  assert.equal(sourcesHTML(null,snapshot),'');
});

test('an HTML archive is explicitly labelled as an original documentation file',()=>{
  const links=sourceLinks({...source,source_url:source.source_url.replace('.pdf','.html')},snapshot);
  assert.match(links[1].label,/HTML.*للتوثيق/);
  assert.ok(links[1].href.startsWith('https://github.com/'));
});

test('unsafe URLs, lookalike domains, credentials and unexpected archive revisions are rejected',()=>{
  for(const url of ['javascript:alert(1)','http://www.uqn.gov.sa/','https://uqn.gov.sa.evil.test/',
    'https://evil.test/?next=https://uqn.gov.sa','https://user:pass@uqn.gov.sa/',
    'https://uqn.gov.sa:444/','https://uqn.gov.sa/\\evil','https://uqn.gov.sa/\nfoo']) assert.equal(publisherLink(url),null,url);
  for(const url of ['javascript:alert(1)',source.source_url.replace(snapshot,'b'.repeat(40)),
    source.source_url.replace('github.com','github.com.evil.test'),
    'https://github.com/ahzh999-rgb/saudi-legislation/blob/'+snapshot+'/sources/%2e%2e%2fsecret']) {
    assert.ok(!sourceLinks({...source,source_url:url,publisher_urls:[]},snapshot).some(l=>l.kind==='archive'),url);
  }
});

test('a university-hosted copy is labelled as a copy and duplicate publishers collapse',()=>{
  const copy=publisherLink('https://www.mu.edu.sa/sites/default/files/scan.pdf');
  assert.equal(copy.kind,'publisher_copy');
  assert.match(copy.label,/نسخة منشورة لدى جامعة المجمعة/);
  assert.ok(!copy.label.includes('المصدر الرسمي'));
  const links=sourceLinks({...source,publisher_urls:[...source.publisher_urls,source.publisher_urls[0]]},snapshot);
  assert.equal(links.length,4);
});

test('rendering escapes labels and identifiers, preserves future notices and opens publishers safely',()=>{
  const html=sourcesHTML([{...source,title:'<img src=x onerror=alert(1)>',instrument_id:'x" onclick="alert(1)',
    temporal:{state:'FUTURE_RECORDED'}}],snapshot);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes(' onclick="'));
  assert.ok(html.includes('المادة 10 مكرر 2'));
  assert.ok(html.includes('لم يبدأ نفاذه'));
  assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'));
  assert.ok(html.includes('قد تعرض نسخة مختلفة أو أحدث'));
});
