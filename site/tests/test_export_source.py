import hashlib,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from export_source import eligible_result,publisher_urls
ROOT=Path(__file__).resolve().parents[1]
class ExportTests(unittest.TestCase):
    def test_publisher_urls_only_export_explicit_trusted_document_references(self):
        urls=publisher_urls({'official_source_url':'https://www.uqn.gov.sa/details?p=18244',
            'official_boe_url':'https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/example/1',
            'unrelated_search_url':'https://www.uqn.gov.sa/search?q=anything'})
        self.assertEqual(len(urls),2)
        self.assertIn('18244',urls[0])
        self.assertEqual(publisher_urls({'official_source_url':'https://uqn.gov.sa.evil.test/'}),[])
        self.assertEqual(publisher_urls({'official_source_url':'javascript:alert(1)'}),[])
        self.assertEqual(publisher_urls({'official_source_url':'https://user:pass@uqn.gov.sa/'}),[])
        self.assertEqual(publisher_urls({'official_source_url':'https://uqn.gov.sa:444/'}),[])
        self.assertEqual(publisher_urls({'official_source_url':'https://uqn.gov.sa/\\bad'}),[])
        self.assertEqual(publisher_urls({}),[])
    def test_publisher_paths_are_encoded_and_university_copies_retained(self):
        self.assertEqual(publisher_urls({'official_source_url':'https://www.mof.gov.sa/لائحة تفضيل.pdf'}),
            ['https://www.mof.gov.sa/%D9%84%D8%A7%D8%A6%D8%AD%D8%A9%20%D8%AA%D9%81%D8%B6%D9%8A%D9%84.pdf'])
        copy='https://www.mu.edu.sa/sites/default/files/scan.pdf'
        self.assertEqual(publisher_urls({'official_source_url':copy,'official_boe_url':copy}),[copy])
    def result(self,**kw):
        body='نص المادة';return dict(status='FOUND_SNAPSHOT',body_kind='OFFICIAL_SNAPSHOT',body=body,body_sha256=hashlib.sha256(body.encode()).hexdigest(),**kw)
    def test_source_policy_preserves_owner_acceptance_without_certifying_it(self):
        x=self.result();self.assertIsNone(eligible_result(x,lambda _:[]))
        x['body_kind']='OWNER_ACCEPTED';self.assertIsNone(eligible_result(x,lambda _:[]))
        x['body_kind']='RAW_WITNESS';self.assertEqual(eligible_result(x,lambda _:[]),'RAW_WITNESS')
        x['body_kind']='UNVERIFIED_TEXT';self.assertEqual(eligible_result(x,lambda _:[]),'UNVERIFIED_TEXT')
    def test_conflict_corruption_and_bad_text_are_excluded(self):
        x=self.result();x['status']='FOUND_WITH_CONFLICT';self.assertEqual(eligible_result(x,lambda _:[]),'FOUND_WITH_CONFLICT')
        x=self.result();x['body']='changed';self.assertEqual(eligible_result(x,lambda _:[]),'BODY_HASH_MISMATCH')
        self.assertEqual(eligible_result(self.result(),lambda _:['ARABIC_PRESENTATION_FORMS']),'ARABIC_PRESENTATION_FORMS')
    def test_generated_manifest_matches_every_section_and_browser_order(self):
        public=ROOT/'public';manifest=json.loads((public/'source-manifest.json').read_text());data=json.loads((public/'data.json').read_text())
        self.assertEqual(hashlib.sha256((public/'data.json').read_bytes()).hexdigest(),manifest['data_sha256'])
        self.assertEqual(data['snapshot'],manifest['commit'])
        flat=[(doc,h,b) for doc in data['docs'] for h,b in doc['secs']]
        self.assertEqual(len(flat),manifest['section_count'])
        self.assertFalse(manifest['currentness_or_applicability_established'])
        for i,(doc,h,b) in enumerate(flat):
            path=public/'s'/f'{i}.json';s=json.loads(path.read_text())
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),manifest['section_sha256'][str(i)])
            self.assertEqual((s['instrument_id'],s['h'],s['b']),(doc['id'],h,b))
            self.assertEqual(s['body_sha256'],hashlib.sha256(b.encode()).hexdigest())
            self.assertIn(s['body_kind'],['OFFICIAL_SNAPSHOT','OWNER_ACCEPTED'])
            self.assertFalse(s['point_in_time_applicability_established'])
            self.assertIn(manifest['commit'],s['source_url'])
            self.assertIn('owner_approval',s['verification_summary'])
        self.assertEqual({p.stem for p in (public/'s').glob('*.json')},{str(i) for i in range(len(flat))})
if __name__=='__main__':unittest.main()
