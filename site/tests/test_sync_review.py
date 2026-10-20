import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sync_review import ensure_review


class SyncReviewTests(unittest.TestCase):
    def runner(self, records):
        return Mock(side_effect=[subprocess.CompletedProcess([], 0, json.dumps(records)),
                                 subprocess.CompletedProcess([], 0)])

    def test_merged_or_closed_review_does_not_block_a_new_review(self):
        for state in ('MERGED', 'CLOSED'):
            with self.subTest(state=state):
                run = self.runner([{'number': 41, 'state': state}])
                self.assertEqual(ensure_review('owner/repo', 'sync/source', 'main', 'body.md', run=run), 'created')
                listed = run.call_args_list[0].args[0]
                self.assertEqual(listed[listed.index('--state') + 1], 'open')
                self.assertEqual(run.call_args_list[1].args[0][:3], ['gh', 'pr', 'create'])

    def test_existing_open_review_receives_the_new_snapshot_description(self):
        run = self.runner([{'number': 45, 'state': 'OPEN'}])
        self.assertEqual(ensure_review('owner/repo', 'sync/source', 'main', 'latest.md', run=run), 'updated')
        argv = run.call_args_list[1].args[0]
        self.assertEqual(argv[:4], ['gh', 'pr', 'edit', '45'])
        self.assertEqual(argv[argv.index('--body-file') + 1], 'latest.md')

    def test_no_pending_review_creates_one(self):
        run = self.runner([])
        self.assertEqual(ensure_review('owner/repo', 'sync/source', 'main', 'body.md', run=run), 'created')

    def test_list_failure_or_ambiguous_state_stops_without_mutation(self):
        run = Mock(side_effect=subprocess.CalledProcessError(1, ['gh', 'pr', 'list']))
        with self.assertRaises(subprocess.CalledProcessError):
            ensure_review('owner/repo', 'sync/source', 'main', 'body.md', run=run)
        self.assertEqual(run.call_count, 1)
        run = self.runner([{'number': 1, 'state': 'OPEN'}, {'number': 2, 'state': 'OPEN'}])
        with self.assertRaises(ValueError):
            ensure_review('owner/repo', 'sync/source', 'main', 'body.md', run=run)
        self.assertEqual(run.call_count, 1)


if __name__ == '__main__':
    unittest.main()
