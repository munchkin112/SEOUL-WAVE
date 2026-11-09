"""Classify changed paths conservatively for the verified application pipeline."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys


SHA_PATTERN = re.compile(r'[0-9a-f]{40}')
RUN_ID_PATTERN = re.compile(r'[0-9]{1,20}')
ZERO_SHA = '0' * 40

# These trees contain executable application, infrastructure, CI, or deployment
# inputs. A Markdown file in one of them must not make the run docs-only.
OPERATIONAL_ROOTS = {
    '.aws', '.github', '.codex', 'backend', 'frontend', 'infrastructure',
    'scripts', 'tests',
}


def is_document_path(path: str) -> bool:
    """Return true only for paths that cannot affect application or release behavior."""
    if not isinstance(path, str) or not path:
        return False
    normalized = path.replace('\\', '/')
    if normalized.startswith('/') or any(part in {'.', '..', ''} for part in normalized.split('/')):
        return False

    parts = normalized.lower().split('/')
    if parts[0] in OPERATIONAL_ROOTS:
        return False
    if parts[0] in {'docs', 'readme-assets'} and len(parts) > 1:
        return True
    return parts[-1] == 'readme.md' or normalized.lower().endswith('.md')


def is_documentation_only(paths) -> bool:
    """Empty or unknown path sets fail closed and require the application pipeline."""
    if not isinstance(paths, (list, tuple)) or not paths:
        return False
    return all(is_document_path(path) for path in paths)


def _event_range(event: dict, current_sha: str, event_name: str = ''):
    if not isinstance(event, dict) or SHA_PATTERN.fullmatch(current_sha or '') is None:
        raise ValueError('A valid workflow event and current commit SHA are required.')

    event_name = event_name or event.get('event_name')
    if event_name == 'push':
        before = event.get('before')
        after = event.get('after')
        if SHA_PATTERN.fullmatch(after or '') is None or after != current_sha:
            raise ValueError('Push event commit does not match the checked-out commit.')
        if before == ZERO_SHA:
            return None, None, 'unknown_base'
    elif event_name == 'pull_request':
        pull_request = event.get('pull_request')
        base = pull_request.get('base') if isinstance(pull_request, dict) else None
        before = base.get('sha') if isinstance(base, dict) else None
        after = current_sha
    else:
        return None, None, 'manual_or_other_event'

    if SHA_PATTERN.fullmatch(before or '') is None:
        raise ValueError('A valid base commit SHA is required for change detection.')
    return before, after, 'git_diff'


def changed_paths(before: str, after: str, *, runner=subprocess.run):
    """Read both sides of renames so a code-to-doc rename remains a code change."""
    result = runner(
        ['git', 'diff', '--name-only', '--no-renames', '-z', before, after],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError('Git could not compare the workflow commits.')
    output = result.stdout
    if isinstance(output, str):
        output = output.encode('utf-8')
    try:
        values = output.decode('utf-8').split('\0')
    except UnicodeDecodeError:
        raise RuntimeError('Git returned a path that is not valid UTF-8.') from None
    return sorted(set(value for value in values if value))


def detect(event: dict, current_sha: str, run_id: str, *, event_name='', runner=subprocess.run) -> dict:
    if RUN_ID_PATTERN.fullmatch(str(run_id)) is None:
        raise ValueError('A valid workflow run ID is required.')
    before, after, reason = _event_range(event, current_sha, event_name)
    files = changed_paths(before, after, runner=runner) if before is not None else []
    docs_only = reason == 'git_diff' and is_documentation_only(files)
    return {
        'schema_version': 1,
        'source_sha': current_sha,
        'run_id': str(run_id),
        'docs_only': docs_only,
        'reason': reason,
        'changed_files': files,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--event', type=Path,
                        default=Path(os.environ.get('GITHUB_EVENT_PATH', 'event.json')))
    parser.add_argument('--sha', default=os.environ.get('GITHUB_SHA', ''))
    parser.add_argument('--run-id', default=os.environ.get('GITHUB_RUN_ID', ''))
    parser.add_argument('--event-name', default=os.environ.get('GITHUB_EVENT_NAME', ''))
    parser.add_argument('--output', type=Path, default=Path('change-detection.json'))
    args = parser.parse_args(argv)

    event = json.loads(args.event.read_text(encoding='utf-8'))
    result = detect(event, args.sha, args.run_id, event_name=args.event_name)
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    github_output = os.environ.get('GITHUB_OUTPUT')
    if github_output:
        with open(github_output, 'a', encoding='utf-8') as output:
            output.write(f"docs_only={str(result['docs_only']).lower()}\n")
    changed = ', '.join(result['changed_files']) or '(no comparable file changes)'
    print(f"docs_only={str(result['docs_only']).lower()} ({result['reason']})")
    print(f'Changed paths: {changed}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f'Change detection failed: {error}', file=sys.stderr)
        raise SystemExit(1)
