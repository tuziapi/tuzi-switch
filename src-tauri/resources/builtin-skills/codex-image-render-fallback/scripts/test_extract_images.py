#!/usr/bin/env python3

import base64
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


SCRIPT_PATH = Path(__file__).with_name("extract_images.py")
SPEC = importlib.util.spec_from_file_location("extract_images", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot load {SCRIPT_PATH}")
extract_images = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = extract_images
SPEC.loader.exec_module(extract_images)


ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class ExtractImagesTest(unittest.TestCase):
    def test_non_string_type_and_kind_are_ignored(self) -> None:
        record = {
            "schema": {"type": {"type": "string"}, "kind": ["schema"]},
            "items": [
                {"type": ["image_generation_call"]},
                {"kind": {"name": "image_gen.generation"}},
            ],
        }

        self.assertEqual(list(extract_images._iter_image_items(record)), [])

    def test_session_with_object_type_publishes_completed_image(self) -> None:
        encoded = base64.b64encode(ONE_PIXEL_PNG).decode("ascii")
        record = {
            "schema": {"type": {"type": "string"}, "kind": ["schema"]},
            "payload": {
                "type": "image_generation_call",
                "id": "ig-object-type-regression",
                "status": "completed",
                "result": encoded,
            },
        }

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            session = root / "session.jsonl"
            session.write_text(json.dumps(record) + "\n", encoding="utf-8")
            output_dir = root / "output"
            output_dir.mkdir()

            images = extract_images.publish_session(
                session,
                output_dir,
                [],
                extract_images.Limits(
                    max_image_bytes=extract_images.DEFAULT_MAX_IMAGE_BYTES,
                    max_total_bytes=extract_images.DEFAULT_MAX_TOTAL_BYTES,
                    max_jsonl_line_bytes=extract_images.DEFAULT_MAX_JSONL_LINE_BYTES,
                    max_images=extract_images.DEFAULT_MAX_IMAGES,
                    max_dimension=extract_images.DEFAULT_MAX_DIMENSION,
                    max_pixels=extract_images.DEFAULT_MAX_PIXELS,
                ),
            )

            self.assertEqual(len(images), 1)
            self.assertEqual(images[0]["call_id"], "ig-object-type-regression")
            self.assertEqual(images[0]["source"], "base64")
            self.assertEqual((images[0]["width"], images[0]["height"]), (1, 1))
            self.assertEqual(Path(images[0]["path"]).read_bytes(), ONE_PIXEL_PNG)

    def test_markdown_target_encodes_reserved_path_characters(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.png"
            source.write_bytes(ONE_PIXEL_PNG)
            output_dir = root / "markdown # > % ?"
            output_dir.mkdir()

            images = extract_images.publish_saved_paths(
                [source],
                output_dir,
                extract_images.Limits(
                    max_image_bytes=extract_images.DEFAULT_MAX_IMAGE_BYTES,
                    max_total_bytes=extract_images.DEFAULT_MAX_TOTAL_BYTES,
                    max_jsonl_line_bytes=extract_images.DEFAULT_MAX_JSONL_LINE_BYTES,
                    max_images=extract_images.DEFAULT_MAX_IMAGES,
                    max_dimension=extract_images.DEFAULT_MAX_DIMENSION,
                    max_pixels=extract_images.DEFAULT_MAX_PIXELS,
                ),
            )

            self.assertIn("markdown # > % ?", images[0]["path"])
            markdown = images[0]["markdown"]
            for encoded in ["%20", "%23", "%3E", "%25", "%3F"]:
                self.assertIn(encoded, markdown)


if __name__ == "__main__":
    unittest.main()
