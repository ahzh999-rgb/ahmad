"""Create or refresh an OPEN source-update PR; a merged/closed PR is not pending review."""
import argparse
import json
import subprocess


def ensure_review(repository, head, base, body_file, *, run=subprocess.run):
    listed = run(['gh', 'pr', 'list', '--repo', repository, '--head', head,
                  '--base', base, '--state', 'open', '--json', 'number,state'],
                 check=True, capture_output=True, text=True)
    records = json.loads(listed.stdout)
    if not isinstance(records, list):
        raise ValueError('Unexpected pull request response')
    pending = [row for row in records if row.get('state') == 'OPEN']
    if len(pending) > 1:
        raise ValueError('More than one open source-update pull request')
    title = 'Update canonical legislation snapshot'
    if pending:
        argv = ['gh', 'pr', 'edit', str(pending[0]['number']), '--repo', repository]
        action = 'updated'
    else:
        argv = ['gh', 'pr', 'create', '--repo', repository, '--base', base, '--head', head]
        action = 'created'
    run(argv + ['--title', title, '--body-file', body_file], check=True)
    return action


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--head', default='sync/canonical-source')
    parser.add_argument('--base', default='main')
    parser.add_argument('--body-file', required=True)
    args = parser.parse_args()
    print('Source review ' + ensure_review(args.repo, args.head, args.base, args.body_file))
