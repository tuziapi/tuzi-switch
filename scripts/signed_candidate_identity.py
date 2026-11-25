"""Identity assertions shared by the disposable Linux/Mac signed-package tests."""
import json
from pathlib import Path
import re

PAIR = json.loads(Path(__file__).with_name('signed-candidate-pair.json').read_text())
BASE_VERSION = PAIR['base']['version']
TARGET_VERSION = PAIR['target']['version']


def verify_candidate(candidate, role):
    assert PAIR['schemaVersion'] == 1
    assert PAIR['repository'] == 'AiW520/tuzi-switch'
    assert PAIR['releaseRepository'] == 'tuziapi/tuzi-switch'
    assert role in ('base', 'target')
    expected = PAIR[role]
    assert re.fullmatch(r'[1-9]\d*', expected['runId'])
    assert re.fullmatch(r'[a-f0-9]{40}', expected['commit'])
    # Versions are pinned by the reviewed source/run pair, not artifact metadata.
    assert re.fullmatch(r'\d+\.\d+\.\d+', BASE_VERSION)
    assert re.fullmatch(r'\d+\.\d+\.\d+', TARGET_VERSION)
    assert tuple(map(int, BASE_VERSION.split('.'))) < tuple(map(int, TARGET_VERSION.split('.')))
    assert PAIR['base']['runId'] != PAIR['target']['runId']
    assert PAIR['base']['commit'] != PAIR['target']['commit']
    assert candidate['schemaVersion'] == 2
    for field in ('repository', 'releaseRepository', 'publicKeySha256'):
        assert candidate[field] == PAIR[field], field
    for field in ('runId', 'commit'):
        assert candidate[field] == expected[field], field
    assert candidate['tag'] == 'v' + expected['version']
