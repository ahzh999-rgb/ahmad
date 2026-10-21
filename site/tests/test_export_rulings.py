import hashlib, json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import export_rulings
ROOT = Path(__file__).resolve().parents[1]
class RulingsAssets(unittest.TestCase):
    def test_lock_and_manifest_agree(self):
        lock = json.loads((ROOT / 'rulings-lock.json').read_text())
        manifest = json.loads((ROOT / 'public/rulings/manifest.json').read_text())
        self.assertEqual(lock['commit'], manifest['commit'])
        self.assertEqual(lock['repository'], export_rulings.REPOSITORY)
    def test_every_file_matches_manifest_and_nothing_extra(self):
        out = ROOT / 'public/rulings'; manifest = json.loads((out / 'manifest.json').read_text())
        files = {p.relative_to(out).as_posix() for p in out.rglob('*') if p.is_file()} - {'manifest.json'}
        self.assertEqual(files, set(manifest['files']))
        for name, digest in manifest['files'].items():
            self.assertEqual(hashlib.sha256((out / name).read_bytes()).hexdigest(), digest, name)
    def test_records_carry_case_numbers_and_stay_out_of_answers(self):
        catalog = json.loads((ROOT / 'public/rulings/catalog.json').read_text())
        for r in catalog['rulings']:
            self.assertTrue(r['case']['first_instance'] or r['case']['appeal'], r['id'])
            self.assertEqual(r['verification'], 'MACHINE_READ')
        data = (ROOT / 'public/data.json').read_text()
        self.assertNotIn('BOG-1444-', data)
if __name__ == '__main__':
    unittest.main()
