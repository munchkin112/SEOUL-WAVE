import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/ci/notify_discord.py'
spec = importlib.util.spec_from_file_location('ci_notify_discord', SCRIPT)
notify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notify)


class CiNotificationTests(unittest.TestCase):
    def test_docs_only_skips_are_reported_as_success(self):
        results = {
            'changes': 'success', 'docs_only': 'true', 'contracts': 'success',
            'backend': 'skipped', 'frontend': 'skipped', 'integration': 'skipped',
            'gate': 'success', 'publish': 'skipped',
        }
        self.assertEqual(notify.failed_checks(results), [])

    def test_application_test_failure_remains_a_discord_failure(self):
        results = {
            'changes': 'success', 'docs_only': 'false', 'contracts': 'success',
            'backend': 'failure', 'frontend': 'success', 'integration': 'skipped',
            'gate': 'failure', 'publish': 'skipped',
        }
        self.assertIn('backend', notify.failed_checks(results))
        self.assertIn('gate', notify.failed_checks(results))

    def test_pull_request_publish_skip_remains_an_accepted_result(self):
        results = {
            'changes': 'success', 'docs_only': 'false', 'contracts': 'success',
            'backend': 'success', 'frontend': 'success', 'integration': 'success',
            'gate': 'success', 'publish': 'skipped',
        }
        self.assertEqual(notify.failed_checks(results), [])


if __name__ == '__main__':
    unittest.main()
