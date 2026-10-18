import hashlib,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from export_source import eligible_result
ROOT=Path(__file__).resolve().parents[1]
class ExportTests(unittest.TestCase):
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
