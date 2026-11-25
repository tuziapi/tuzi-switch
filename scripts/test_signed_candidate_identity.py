"""Reject stale or substituted native-upgrade evidence across version changes."""
import copy
import unittest
from unittest.mock import patch

import signed_candidate_identity as identity


class CandidateIdentityTests(unittest.TestCase):
    def fixture(self, base_version='1.6.3', target_version='1.6.4'):
        pair = copy.deepcopy(identity.PAIR)
        pair['base']['version'] = base_version
        pair['target']['version'] = target_version
        candidate = {
            'schemaVersion': 2,
            **{key: pair[key] for key in ('repository', 'releaseRepository', 'publicKeySha256')},
            **{key: pair['target'][key] for key in ('runId', 'commit')},
            'tag': 'v' + target_version,
        }
        return pair, candidate

    def verify(self, pair, candidate):
        with patch.multiple(identity, PAIR=pair,
                            BASE_VERSION=pair['base']['version'],
                            TARGET_VERSION=pair['target']['version']):
            identity.verify_candidate(candidate, 'target')

    def test_accepts_new_reviewed_version_pair(self):
        self.verify(*self.fixture())

    def test_rejects_stale_artifact_identity(self):
        pair, candidate = self.fixture()
        for field, wrong in [('tag', 'v1.6.3'), ('runId', '123456789'),
                             ('commit', 'a' * 40), ('repository', 'foreign/repo'),
                             ('publicKeySha256', '0' * 64)]:
            with self.subTest(field=field), self.assertRaises(AssertionError):
                self.verify(pair, {**candidate, field: wrong})

    def test_rejects_equal_downgraded_or_invalid_versions(self):
        for base, target in [('1.6.4', '1.6.4'), ('1.6.4', '1.6.3'), ('1.6.3', 'invalid')]:
            with self.subTest(target=target), self.assertRaises(AssertionError):
                self.verify(*self.fixture(base, target))


if __name__ == '__main__':
    unittest.main()
