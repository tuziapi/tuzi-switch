"""Identity assertions shared by the disposable Linux/Mac signed-package tests."""
import json
from pathlib import Path
import re

PAIR = json.loads(Path(__file__).with_name('signed-candidate-pair.json').read_text())


def verify_candidate(candidate, role):
    assert PAIR['schemaVersion'] == 1
    assert PAIR['repository'] == 'AiW520/tuzi-switch'
    assert PAIR['releaseRepository'] == 'tuziapi/tuzi-switch'
    assert role in ('base', 'target')
    expected = PAIR[role]
    assert re.fullmatch(r'[1-9]\d*', expected['runId'])
    assert re.fullmatch(r'[a-f0-9]{40}', expected['commit'])
    # These UI experiments are specifically for the new-key 1.6.2 transition.
    assert PAIR['base']['version'] == '1.6.2'
    assert PAIR['target']['version'] == '1.6.3'
    assert PAIR['base']['runId'] != PAIR['target']['runId']
    assert PAIR['base']['commit'] != PAIR['target']['commit']
    assert candidate['schemaVersion'] == 2
    for field in ('repository', 'releaseRepository', 'publicKeySha256'):
        assert candidate[field] == PAIR[field], field
    for field in ('runId', 'commit'):
        assert candidate[field] == expected[field], field
    assert candidate['tag'] == 'v' + expected['version']
