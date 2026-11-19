import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location("per_user_msi", Path(__file__).with_name("prepare-windows-msi.py"))
msi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(msi)
NAMESPACE = {"w": "http://schemas.microsoft.com/wix/2006/wi"}


class PerUserResources(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        source = self.root / "src-tauri"
        (source / "wix").mkdir(parents=True)
        shutil.copy2(Path(__file__).resolve().parents[1] / "src-tauri/wix/per-user-main.wxs", source / "wix/per-user-main.wxs")
        (source / "LICENSE").write_text("SYNTHETIC")
        self.output = source / "target/release"
        self.output.mkdir(parents=True)
        self.template = source / "target/generated.wxs"
        self.config = {"bundle": {"resources": {"LICENSE": "licenses/nested/LICENSE-renamed.txt"}}}

    def test_resources_keep_names_bytes_per_user_keys_and_directory_cleanup(self):
        (self.output / "synthetic.dll").write_bytes(b"SYNTHETIC DLL")
        files = msi.prepare_template(self.root, self.config, self.output, self.template)
        self.assertEqual(set(files), {"licenses/nested/license-renamed.txt", "synthetic.dll"})
        document = ET.parse(self.template)
        components = [component for component in document.findall(".//w:Component", NAMESPACE) if component.get("Id").startswith("TuziResource")]
        self.assertEqual(len(components), 3)
        for component in components:
            registry = component.find("w:RegistryValue", NAMESPACE)
            self.assertEqual((registry.get("Root"), registry.get("KeyPath")), ("HKCU", "yes"))
            for installed_file in component.findall("w:File", NAMESPACE):
                self.assertEqual(installed_file.get("KeyPath"), "no")
                self.assertTrue(Path(installed_file.get("Source")).is_file())
        names = {entry.get("Name") for component in components for entry in component.findall("w:File", NAMESPACE)}
        self.assertEqual(names, {"LICENSE-renamed.txt", "synthetic.dll"})
        directories = {entry.get("Id") for entry in document.findall(".//w:Directory", NAMESPACE) if entry.get("Id").startswith("TuziDir_")}
        removed = {entry.get("Directory") for component in components for entry in component.findall("w:RemoveFolder", NAMESPACE)}
        self.assertEqual(directories, removed)
        references = {entry.get("Id") for entry in document.findall(".//w:ComponentRef", NAMESPACE)}
        self.assertTrue({component.get("Id") for component in components} <= references)
        first = self.template.read_bytes()
        msi.prepare_template(self.root, self.config, self.output, self.template)
        self.assertEqual(self.template.read_bytes(), first)

    def test_rejects_ambiguous_or_escaping_destinations(self):
        for destination in ("../escape.txt", "/escape.txt", "C:/escape.txt"):
            with self.subTest(destination=destination):
                self.config["bundle"]["resources"] = {"LICENSE": destination}
                with self.assertRaises(ValueError):
                    msi.prepare_template(self.root, self.config, self.output, self.template)
        (self.root / "src-tauri/other.txt").write_text("SYNTHETIC")
        self.config["bundle"]["resources"] = {"LICENSE": "same.txt", "other.txt": "SAME.txt"}
        with self.assertRaises(ValueError):
            msi.prepare_template(self.root, self.config, self.output, self.template)


if __name__ == "__main__":
    unittest.main()
