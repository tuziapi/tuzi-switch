from pathlib import Path

root = Path(__file__).resolve().parents[1]
for excluded in (
    'src-tauri/src/services/workbuddy_account',
    'src-tauri/vendor/claude-local/runtime/proxy.mjs',
    'src-tauri/vendor/claude-local/runtime/scripts/gen-ca.sh',
):
    assert not (root / excluded).exists(), excluded
for path in (root / 'src-tauri/src').rglob('*.rs'):
    source = path.read_text()
    for excluded in ('workbuddy_account_import_current', 'workbuddy_accounts.json', 'workbuddy-desktop.info', 'keyblob'):
        assert excluded not in source, path
