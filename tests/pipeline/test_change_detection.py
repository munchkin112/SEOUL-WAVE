import importlib.util
from pathlib import Path
import subprocess
import unittest
from types import SimpleNamespace


SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/ci/change_detection.py'
spec = importlib.util.spec_from_file_location('change_detection', SCRIPT)
change_detection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(change_detection)


class ChangeDetectionTests(unittest.TestCase):
    def test_readme_only_changes_are_documentation_only(self):
        self.assertTrue(change_detection.is_documentation_only(['README.md']))

    def test_docs_and_readme_assets_are_documentation_only(self):
        self.assertTrue(change_detection.is_documentation_only([
            'docs/operations/ec2-deployment.md',
            'docs/architecture/overview.pdf',
            'readme-assets/architecture.svg',
        ]))

    def test_general_markdown_is_documentation_outside_operational_trees(self):
        self.assertTrue(change_detection.is_documentation_only([
            'CONTRIBUTING.md', 'examples/README.md',
        ]))

    def test_frontend_backend_docker_compose_deployment_and_ci_changes_are_runtime(self):
        runtime_paths = [
            'frontend/src/App.tsx',
            'backend/app/main.py',
            'backend/README.md',
            'backend/Dockerfile',
            'frontend/Dockerfile.prod',
            'compose.prod.yaml',
            'scripts/deploy/dispatch.py',
            '.github/workflows/pipeline.yml',
        ]
        for path in runtime_paths:
            with self.subTest(path=path):
                self.assertFalse(change_detection.is_documentation_only([path]))

    def test_readme_and_code_together_require_the_full_application_pipeline(self):
        self.assertFalse(change_detection.is_documentation_only([
            'README.md', 'frontend/src/App.tsx',
        ]))

    def test_empty_or_malformed_path_sets_fail_closed(self):
        for paths in ([], None, ['../README.md'], ['/README.md'], [''], ['docs']):
            with self.subTest(paths=paths):
                self.assertFalse(change_detection.is_documentation_only(paths))

    def test_changed_paths_include_both_sides_of_renames(self):
        calls = []

        def runner(arguments, **kwargs):
            calls.append((arguments, kwargs))
            return SimpleNamespace(returncode=0, stdout=b'old.py\0README.md\0', stderr=b'')

        paths = change_detection.changed_paths('a' * 40, 'b' * 40, runner=runner)
        self.assertEqual(paths, ['README.md', 'old.py'])
        self.assertIn('--no-renames', calls[0][0])
        self.assertIn('-z', calls[0][0])

    def test_readme_push_uses_before_and_after_commit(self):
        calls = []

        def runner(arguments, **_kwargs):
            calls.append(arguments)
            return SimpleNamespace(returncode=0, stdout=b'README.md\0', stderr=b'')

        result = change_detection.detect({
            'event_name': 'push', 'before': 'a' * 40, 'after': 'b' * 40,
        }, 'b' * 40, '123', runner=runner)
        self.assertTrue(result['docs_only'])
        self.assertEqual(result['changed_files'], ['README.md'])
        self.assertIn('a' * 40, calls[0])
        self.assertIn('b' * 40, calls[0])

    def test_pull_request_compares_base_to_the_checked_out_merge_commit(self):
        calls = []

        def runner(arguments, **_kwargs):
            calls.append(arguments)
            return SimpleNamespace(returncode=0, stdout=b'docs/guide.md\0', stderr=b'')

        result = change_detection.detect({
            'event_name': 'pull_request',
            'pull_request': {'base': {'sha': 'c' * 40}},
        }, 'd' * 40, '456', runner=runner)
        self.assertTrue(result['docs_only'])
        self.assertEqual(calls[0][-2:], ['c' * 40, 'd' * 40])

    def test_new_branch_and_manual_runs_fail_closed_to_full_pipeline(self):
        new_branch = change_detection.detect({
            'event_name': 'push', 'before': '0' * 40, 'after': 'e' * 40,
        }, 'e' * 40, '789')
        manual = change_detection.detect({'event_name': 'workflow_dispatch'}, 'f' * 40, '790')
        self.assertFalse(new_branch['docs_only'])
        self.assertFalse(manual['docs_only'])

    def test_git_compare_failure_fails_the_detection_job(self):
        def runner(_arguments, **_kwargs):
            return subprocess.CompletedProcess([], 128, b'', b'missing commit')

        with self.assertRaisesRegex(RuntimeError, 'could not compare'):
            change_detection.detect({
                'event_name': 'push', 'before': 'a' * 40, 'after': 'b' * 40,
            }, 'b' * 40, '123', runner=runner)


if __name__ == '__main__':
    unittest.main()
