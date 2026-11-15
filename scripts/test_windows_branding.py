"""Local installer-source regression checks; not Windows installation acceptance."""
import json
import pathlib
import re
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class WindowsBranding(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / 'src-tauri/tauri.conf.json').read_text())
        self.nsis = (ROOT / 'src-tauri/nsis/installer.nsi').read_text()
        self.wix = (ROOT / 'src-tauri/wix/per-user-main.wxs').read_text()

    def test_release_keeps_upgrade_and_registry_identity(self):
        release = json.loads(subprocess.check_output(['node', 'scripts/tauri-release-config.cjs', '--desktop-product-name', '--unsigned'], cwd=ROOT))
        self.assertEqual(release['productName'], 'tuzi switch')
        self.assertFalse(release['bundle']['createUpdaterArtifacts'])
        self.assertEqual(self.config['identifier'], 'com.tuziswitch.desktop')
        self.assertEqual(self.config['bundle']['windows']['wix']['upgradeCode'], '9462cc07-4102-53d3-9279-a97d4fe6a920')
        self.assertIn('!define UNINSTKEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${PRODUCTNAME}"', self.nsis)
        self.assertIn('!define MANUPRODUCTKEY "${MANUKEY}\\${PRODUCTNAME}"', self.nsis)
        self.assertIn('<Directory Id="INSTALLDIR" Name="{{product_name}}"/>', self.wix)

    def test_both_installer_templates_are_wired_and_chinese_encodable(self):
        windows = self.config['bundle']['windows']
        self.assertEqual(windows['wix']['language'], 'zh-CN')
        self.assertEqual(windows['nsis']['languages'], ['SimpChinese', 'English'])
        for kind in ['wix', 'nsis']:
            self.assertTrue((ROOT/'src-tauri'/windows[kind]['template']).is_file())
        self.assertIn('Unicode true', self.nsis)

    def test_nsis_display_and_shortcut_names_use_brand(self):
        self.assertIn('!define DISPLAYNAME "兔子助手"', self.nsis)
        self.assertIn('Name "${DISPLAYNAME}"', self.nsis)
        self.assertIn('"DisplayName" "${DISPLAYNAME}"', self.nsis)
        for line in self.nsis.splitlines():
            if 'CreateShortcut ' in line:
                self.assertIn('${DISPLAYNAME}.lnk', line)
                self.assertNotIn('${PRODUCTNAME}.lnk', line)
        self.assertIn('"${DISPLAYNAME}${MANUFACTURER}" 0 wix_loop', self.nsis)
        self.assertIn('"${PRODUCTNAME}${MANUFACTURER}" tuzi_wix_name_match', self.nsis)

    def test_nsis_migrates_only_owned_links_before_shortcut_skip_checks(self):
        macro = self.nsis.split('!macro TuziMigrateShortcut LEGACY CURRENT')[1].split('!macroend')[0]
        self.assertIn('IsShortcutTarget "${LEGACY}" "$INSTDIR\\${MAINBINARYNAME}.exe"', macro)
        self.assertIn('IsShortcutTarget "${LEGACY}" "$INSTDIR\\$OldMainBinaryName"', macro)
        self.assertIn('${IfNot} ${FileExists} "${CURRENT}"', macro)
        self.assertIn('Rename "${LEGACY}" "${CURRENT}"', macro)
        self.assertIn('IsShortcutTarget "${CURRENT}" "$INSTDIR\\${MAINBINARYNAME}.exe"', macro)
        for function in ['CreateOrUpdateStartMenuShortcut', 'CreateOrUpdateDesktopShortcut']:
            body = self.nsis.split('Function '+function+'\n')[1].split('FunctionEnd')[0]
            self.assertLess(body.index('TuziMigrateShortcut'), body.index('$NoShortcutMode'))
            self.assertIn('TuziPreserveForeignShortcut', body)
        self.assertLess(self.nsis.index('!macro TuziMigrateShortcut'), self.nsis.index('!insertmacro TuziMigrateShortcut'))

    def test_nsis_uninstaller_removes_branded_shortcuts_with_target_check(self):
        section = self.nsis.split('Section Uninstall')[1].split('SectionEnd')[0]
        self.assertEqual(len(re.findall(r'Delete "[^\n]+DISPLAYNAME}\.lnk"', section)), 3)
        self.assertEqual(section.count('!insertmacro IsShortcutTarget'), 3)

    def test_wix_labels_and_migration_preserve_managed_component_ids(self):
        self.assertIn('Name="$(var.TuziDisplayName)"', self.wix)
        self.assertIn('<?define TuziDisplayName = "兔子助手" ?>', self.wix)
        for name in ['ApplicationShortcutDesktop', 'ApplicationShortcut', 'CMP_UninstallShortcut']:
            self.assertIn('Component Id="'+name+'"', self.wix)
        for name in ['RemoveLegacyDesktopShortcut', 'RemoveLegacyStartMenuShortcut', 'RemoveLegacyUninstallShortcut']:
            self.assertRegex(self.wix, r'Id="'+name+r'" Name="[^"]+" On="install"')
        self.assertIn('Key="Software\\\\{{manufacturer}}\\\\{{product_name}}"', self.wix)

if __name__ == '__main__':
    unittest.main()
