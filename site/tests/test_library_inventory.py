import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from library_inventory import build_inventory,source_reading,ArticleText


class LibraryInventoryTests(unittest.TestCase):
    def test_html_reading_is_scoped_to_article_and_never_copies_executable_markup(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'source.html'
            path.write_text('<nav>خارج النص</nav><div id="article-content"><p>أولاً: &amp; قرار</p>'
                            '<script>alert("bad")</script><style>.bad{}</style><p>ثانياً:<br>نص المرسوم</p></div><footer>تذييل</footer>')
            reading=source_reading(path)
            self.assertEqual(reading['text'],'أولاً: & قرار\nثانياً:\nنص المرسوم')
            self.assertEqual(reading['source_sha256'],hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(reading['sha256'],hashlib.sha256(reading['text'].encode()).hexdigest())
            self.assertFalse(reading['answer_eligibility_changed'])
    def test_missing_duplicate_unclosed_or_non_content_containers_do_not_produce_a_reading(self):
        for html in ['<body>navigation only</body>',
                     '<div id="article-content">one</div><div id="article-content">two</div>',
                     '<div id="article-content">unclosed',
                     '<script id="article-content">alert(1)</script>']:
            parser=ArticleText();parser.feed(html);parser.close();self.assertIsNone(parser.text())
    def test_decisions_and_gazette_are_discovery_not_answer_eligibility(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            files={
                'sources/gazette-5180-review/issue-5180.pdf':'issue',
                'sources/gazette-5180-review/page-009-full.png':'page',
                'sources/civil-service/uqn4835-pages1-and3-extract.pdf':'extract',
                'sources/civil-service/moj-monthly-report.pdf':'not a gazette issue',
                'sources/labour-gazette-2026-10-20/screenshot.png':'date is not an issue number',
                'sources/labour/uqn-m5-publication.pdf':'m5 issue',
            }
            for name,body in files.items():
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(body)
            (root/'indexes').mkdir()
            (root/'indexes/file_registry.json').write_text(json.dumps({'documents':[]}))
            (root/'analysis').mkdir()
            (root/'analysis/publications.json').write_text(json.dumps([
                {'gazette_issue':'4847','source_path':'sources/labour/uqn-m5-publication.pdf'},
                {'issue_number':'4835','source_path':'sources/civil-service/moj-monthly-report.pdf'},
            ]))
            subprocess.run(['git','init','-q',str(root)],check=True)
            subprocess.run(['git','-C',str(root),'add','.'],check=True)
            # An untracked publication file must not alter reproducible output.
            (root/'analysis/untracked.json').write_text(json.dumps({'gazette_issue':'9999','source_path':'sources/labour/uqn-m5-publication.pdf'}))
            record={'title':'قرار اعتماد لائحة','metadata':'legislation/decision/metadata.json','index':'indexes/instruments.json','data':{'source_path':'sources/labour/uqn-m5-publication.pdf'},'verification':{'dimensions':{}}}
            result=build_inventory(root,{'decision':record},[],'a'*40)
            self.assertFalse(result['answer_eligibility_changed'])
            self.assertEqual(result['decisions'][0]['eligible_article_count'],0)
            issues={r['id']:r for r in result['gazette_issues']}
            self.assertEqual(set(issues),{'5180','4835','4847'})
            self.assertEqual(len(issues['5180']['sources']),2)
            self.assertEqual(issues['4835']['archive_kind'],'PAGES_OR_WITNESSES')
            self.assertEqual(len(issues['4835']['sources']),1)
            for issue in issues.values():
                self.assertFalse(issue['full_issue_verified'])
                self.assertFalse(issue['all_contents_indexed'])
                for source in issue['sources']:
                    self.assertEqual(source['sha256'],hashlib.sha256((root/source['path']).read_bytes()).hexdigest())

    def test_published_inventory_is_pinned_and_matches_manifest(self):
        public=Path(__file__).resolve().parents[1]/'public'
        manifest=json.loads((public/'source-manifest.json').read_text())
        raw=(public/'library-inventory.json').read_bytes();inventory=json.loads(raw)
        self.assertEqual(hashlib.sha256(raw).hexdigest(),manifest['library_inventory_sha256'])
        self.assertEqual(inventory['snapshot'],manifest['commit'])
        self.assertFalse(inventory['answer_eligibility_changed'])
        for collection in ['decisions','gazette_issues']:
            ids=[r['id'] for r in inventory[collection]]
            self.assertEqual(len(ids),len(set(ids)))


class GazetteRelationsTests(unittest.TestCase):
    def test_archived_issue_records_show_explicit_legislation_connections(self):
        path=Path(__file__).resolve().parents[1]/'public/library-inventory.json'
        inventory=json.loads(path.read_text())
        issues={r['id']:r for r in inventory['gazette_issues']}
        expected={'5180':['SA-LAW-GTP-1448-001'],'5186':['SA-REG-GTP-1441-3479'],
                  '4847':['labour-law'],'4828':['conflicts-of-interest','procurement-ethics']}
        for number,ids in expected.items():
            actual={d['id'] for d in issues[number]['related_documents']}
            self.assertTrue(set(ids).issubset(actual))
            for d in issues[number]['related_documents']:
                self.assertEqual(d['relation_scope'],'linked_archive_witness_not_exhaustive_issue_contents')
        record=next(r for r in inventory['decisions'] if r['id']=='public-money-cabinet-835')
        self.assertEqual(record['number'],'835')
        self.assertEqual(record['number_basis'],'title_transcription')
