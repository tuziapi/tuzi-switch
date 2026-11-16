import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("stage_node", Path(__file__).with_name("prepare-claude-local-node.py"))
stage_node = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage_node)


class NodeArchiveTests(unittest.TestCase):
    def extract(self, kind, limit):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "node"
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode="w") as archive:
                member = tarfile.TarInfo("bin/node")
                member.type = kind
                member.size = 4 if kind == tarfile.REGTYPE else 0
                member.linkname = "../../outside"
                archive.addfile(member, io.BytesIO(b"NODE") if member.size else None)
            buffer.seek(0)
            with tarfile.open(fileobj=buffer) as archive:
                stage_node.extract_member(archive, "bin/node", output, limit, 0o755)
            self.assertEqual(output.read_bytes(), b"NODE")
            self.assertEqual(output.stat().st_mode & 0o777, 0o755)

    def test_extracts_only_regular_verified_member(self):
        self.extract(tarfile.REGTYPE, 4)

    def test_rejects_symbolic_link(self):
        with self.assertRaisesRegex(ValueError, "Invalid archive member"):
            self.extract(tarfile.SYMTYPE, 4)

    def test_rejects_hard_link(self):
        with self.assertRaisesRegex(ValueError, "Invalid archive member"):
            self.extract(tarfile.LNKTYPE, 4)

    def test_rejects_oversized_binary(self):
        with self.assertRaisesRegex(ValueError, "Invalid archive member"):
            self.extract(tarfile.REGTYPE, 3)


if __name__ == "__main__":
    unittest.main()
