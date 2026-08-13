#!/usr/bin/env python3
"""Safely publish generated images without exposing their Base64 payloads."""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
from dataclasses import dataclass
from typing import Any, BinaryIO, Iterable, Iterator, Mapping, Sequence


DEFAULT_MAX_IMAGE_BYTES = 32 * 1024 * 1024
DEFAULT_MAX_TOTAL_BYTES = 128 * 1024 * 1024
DEFAULT_MAX_JSONL_LINE_BYTES = 48 * 1024 * 1024
DEFAULT_MAX_IMAGES = 16
DEFAULT_MAX_DIMENSION = 16_384
DEFAULT_MAX_PIXELS = 100_000_000
BASE64_CHUNK_CHARS = 64 * 1024
FILE_CHUNK_BYTES = 64 * 1024
HEADER_SCAN_LIMIT = 4 * 1024 * 1024
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SOF_MARKERS = frozenset(
    (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF)
)
IMAGE_ITEM_TYPES = frozenset(
    (
        "image_generation_call",
        "image_generation_end",
        "imageGeneration",
        "image_generation",
    )
)
SAFE_STEM_RE = re.compile(r"[^A-Za-z0-9._-]+")


class ExtractionError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise ExtractionError("arguments_invalid", message)


@dataclass(frozen=True)
class Limits:
    max_image_bytes: int
    max_total_bytes: int
    max_jsonl_line_bytes: int
    max_images: int
    max_dimension: int
    max_pixels: int


@dataclass
class StagedImage:
    call_id: str
    part_path: Path
    final_path: Path
    media_type: str
    width: int
    height: int
    size: int
    sha256: str
    source: str
    line: int | None


def _positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be an integer") from error
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = JsonArgumentParser(
        description="Publish validated Codex generated images without printing Base64 data."
    )
    parser.add_argument(
        "--saved-path",
        type=Path,
        action="append",
        default=[],
        help="Image path returned by built-in imagegen. Repeat for multiple images.",
    )
    parser.add_argument(
        "--session",
        type=Path,
        help="Known Codex session JSONL. Defaults to the exact CODEX_THREAD_ID session.",
    )
    parser.add_argument(
        "--output-dir", type=Path, required=True, help="Directory for published images."
    )
    parser.add_argument(
        "--call-id",
        action="append",
        default=[],
        help="Publish only this image call ID. Repeat for multiple calls.",
    )
    parser.add_argument("--max-image-bytes", type=_positive_int, default=DEFAULT_MAX_IMAGE_BYTES)
    parser.add_argument("--max-total-bytes", type=_positive_int, default=DEFAULT_MAX_TOTAL_BYTES)
    parser.add_argument(
        "--max-jsonl-line-bytes", type=_positive_int, default=DEFAULT_MAX_JSONL_LINE_BYTES
    )
    parser.add_argument("--max-images", type=_positive_int, default=DEFAULT_MAX_IMAGES)
    parser.add_argument("--max-dimension", type=_positive_int, default=DEFAULT_MAX_DIMENSION)
    parser.add_argument("--max-pixels", type=_positive_int, default=DEFAULT_MAX_PIXELS)
    return parser


def _exact_thread_matches(root: Path, thread_id: str) -> list[Path]:
    if not root.is_dir():
        return []
    suffix = f"-{thread_id}.jsonl"
    direct_name = f"{thread_id}.jsonl"
    matches: list[Path] = []
    for current_root, directories, files in os.walk(root, followlinks=False):
        directories[:] = [
            name for name in directories if not Path(current_root, name).is_symlink()
        ]
        for name in files:
            if name != direct_name and not name.endswith(suffix):
                continue
            candidate = Path(current_root, name)
            if candidate.is_file() and not candidate.is_symlink():
                matches.append(candidate.resolve())
    return sorted(set(matches), key=str)


def resolve_session(
    explicit: Path | None, environ: Mapping[str, str]
) -> Path:
    if explicit is not None:
        session = explicit.expanduser().resolve()
        if not session.is_file():
            raise ExtractionError("session_not_found", f"Session JSONL does not exist: {session}")
        return session

    thread_id = environ.get("CODEX_THREAD_ID", "").strip()
    if not thread_id:
        raise ExtractionError(
            "thread_id_missing", "CODEX_THREAD_ID is unavailable; pass --session explicitly."
        )
    if not re.fullmatch(r"[A-Za-z0-9_-]+", thread_id):
        raise ExtractionError("thread_id_invalid", "CODEX_THREAD_ID contains unsafe characters.")

    # This managed skill can live under Tuzi Switch's Codex directory override,
    # which intentionally takes precedence over a process-level CODEX_HOME.
    codex_home = Path(__file__).resolve().parents[3]
    for directory in ("sessions", "archived_sessions"):
        matches = _exact_thread_matches(codex_home / directory, thread_id)
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise ExtractionError(
                "session_ambiguous",
                f"Multiple sessions match CODEX_THREAD_ID {thread_id}; pass --session explicitly.",
            )
    raise ExtractionError("session_not_found", f"No session matches CODEX_THREAD_ID {thread_id}.")


def _iter_jsonl(session: Path, max_line_bytes: int) -> Iterator[tuple[int, Any]]:
    try:
        handle = session.open("rb")
    except OSError as error:
        raise ExtractionError("session_unavailable", "Session JSONL cannot be opened.") from error
    with handle:
        line_number = 0
        while True:
            raw = handle.readline(max_line_bytes + 1)
            if not raw:
                return
            line_number += 1
            if len(raw) > max_line_bytes:
                raise ExtractionError(
                    "jsonl_line_exceeded", f"JSONL line {line_number} exceeds the byte limit."
                )
            if not raw.strip():
                continue
            try:
                record = json.loads(raw)
            except (json.JSONDecodeError, UnicodeDecodeError) as error:
                raise ExtractionError(
                    "jsonl_invalid", f"JSONL line {line_number} is not valid UTF-8 JSON."
                ) from error
            del raw
            yield line_number, record


def _iter_image_items(value: Any) -> Iterator[dict[str, Any]]:
    stack = [value]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            if (
                current.get("type") in IMAGE_ITEM_TYPES
                or current.get("kind") == "image_gen.generation"
            ):
                yield current
            stack.extend(reversed(tuple(current.values())))
        elif isinstance(current, list):
            stack.extend(reversed(current))


def _is_completed(item: dict[str, Any]) -> bool:
    return item.get("status", "completed") in ("completed", "success", "succeeded")


def _call_id(item: dict[str, Any], fallback: str) -> str:
    for field in ("id", "call_id", "callId"):
        value = item.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def _saved_path(item: dict[str, Any]) -> Path | None:
    for field in ("savedPath", "saved_path"):
        value = item.get(field)
        if isinstance(value, str) and value.strip():
            path = Path(value.strip()).expanduser()
            if not path.is_absolute():
                raise ExtractionError(
                    "saved_path_invalid", "Generated image savedPath must be absolute."
                )
            return path
    return None


def _safe_stem(call_id: str) -> str:
    stem = SAFE_STEM_RE.sub("_", call_id).strip("._-")[:80]
    return stem or "generated-image"


def _validate_dimensions(width: int, height: int, limits: Limits) -> None:
    if width <= 0 or height <= 0:
        raise ExtractionError("image_dimensions_invalid", "Image dimensions must be positive.")
    if width > limits.max_dimension or height > limits.max_dimension:
        raise ExtractionError(
            "image_dimensions_exceeded",
            f"Image dimensions {width}x{height} exceed the configured dimension limit.",
        )
    if width * height > limits.max_pixels:
        raise ExtractionError(
            "image_pixels_exceeded",
            f"Image dimensions {width}x{height} exceed the configured pixel limit.",
        )


def _read_exact(handle: BinaryIO, size: int, message: str) -> bytes:
    data = handle.read(size)
    if len(data) != size:
        raise ExtractionError("image_format_invalid", message)
    return data


def _validate_png(
    handle: BinaryIO, file_size: int, limits: Limits
) -> tuple[str, str, int, int]:
    handle.seek(0)
    header = _read_exact(handle, 24, "PNG header is truncated.")
    if header[:8] != PNG_SIGNATURE:
        raise ExtractionError("image_format_invalid", "Image has an invalid PNG signature.")
    if int.from_bytes(header[8:12], "big") != 13 or header[12:16] != b"IHDR":
        raise ExtractionError("image_format_invalid", "PNG has no valid IHDR header.")
    width = int.from_bytes(header[16:20], "big")
    height = int.from_bytes(header[20:24], "big")
    _validate_dimensions(width, height, limits)
    if file_size < 45:
        raise ExtractionError("image_format_invalid", "PNG is truncated.")
    handle.seek(-12, os.SEEK_END)
    if handle.read(12) != b"\x00\x00\x00\x00IEND\xaeB\x60\x82":
        raise ExtractionError("image_format_invalid", "PNG has no valid IEND chunk.")
    return "image/png", "png", width, height


def _validate_jpeg(
    handle: BinaryIO, file_size: int, limits: Limits
) -> tuple[str, str, int, int]:
    handle.seek(0)
    if _read_exact(handle, 2, "JPEG is truncated.") != b"\xff\xd8":
        raise ExtractionError("image_format_invalid", "Image has an invalid JPEG signature.")

    while handle.tell() < HEADER_SCAN_LIMIT:
        if _read_exact(handle, 1, "JPEG ended before a frame header.") != b"\xff":
            raise ExtractionError("image_format_invalid", "JPEG contains an invalid marker.")
        marker = _read_exact(handle, 1, "JPEG has a truncated marker.")[0]
        while marker == 0xFF:
            marker = _read_exact(handle, 1, "JPEG has a truncated marker.")[0]
        if marker == 0x00:
            raise ExtractionError("image_format_invalid", "JPEG has stuffed data before SOS.")
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            continue
        if marker in (0xD9, 0xDA):
            raise ExtractionError("image_dimensions_invalid", "JPEG has no frame dimensions.")

        segment_length = int.from_bytes(
            _read_exact(handle, 2, "JPEG has a truncated segment length."), "big"
        )
        if segment_length < 2:
            raise ExtractionError("image_format_invalid", "JPEG has an invalid segment length.")
        payload_length = segment_length - 2
        if handle.tell() + payload_length > HEADER_SCAN_LIMIT:
            raise ExtractionError("image_format_invalid", "JPEG frame header exceeds scan limit.")
        if marker in JPEG_SOF_MARKERS:
            frame = _read_exact(handle, min(payload_length, 5), "JPEG frame is truncated.")
            if payload_length < 5:
                raise ExtractionError("image_format_invalid", "JPEG frame is too short.")
            height = int.from_bytes(frame[1:3], "big")
            width = int.from_bytes(frame[3:5], "big")
            _validate_dimensions(width, height, limits)
            handle.seek(-2, os.SEEK_END)
            if file_size < 4 or handle.read(2) != b"\xff\xd9":
                raise ExtractionError("image_format_invalid", "JPEG has no end marker.")
            return "image/jpeg", "jpg", width, height
        handle.seek(payload_length, os.SEEK_CUR)
    raise ExtractionError("image_format_invalid", "JPEG frame header exceeds scan limit.")


def _validate_webp(
    handle: BinaryIO, file_size: int, limits: Limits
) -> tuple[str, str, int, int]:
    handle.seek(0)
    header = _read_exact(handle, 12, "WebP header is truncated.")
    if header[:4] != b"RIFF" or header[8:12] != b"WEBP":
        raise ExtractionError("image_format_invalid", "Image has an invalid WebP signature.")
    if int.from_bytes(header[4:8], "little") + 8 != file_size:
        raise ExtractionError("image_format_invalid", "WebP RIFF size is inconsistent.")

    canvas: tuple[int, int] | None = None
    while handle.tell() + 8 <= min(file_size, HEADER_SCAN_LIMIT):
        chunk_header = _read_exact(handle, 8, "WebP chunk header is truncated.")
        kind = chunk_header[:4]
        chunk_size = int.from_bytes(chunk_header[4:8], "little")
        payload_start = handle.tell()
        padded_size = chunk_size + (chunk_size & 1)
        if payload_start + padded_size > file_size:
            raise ExtractionError("image_format_invalid", "WebP chunk exceeds file size.")
        if kind == b"VP8X":
            payload = _read_exact(handle, min(chunk_size, 10), "WebP VP8X is truncated.")
            if chunk_size < 10:
                raise ExtractionError("image_format_invalid", "WebP VP8X is too short.")
            width = int.from_bytes(payload[4:7], "little") + 1
            height = int.from_bytes(payload[7:10], "little") + 1
            _validate_dimensions(width, height, limits)
            canvas = (width, height)
            handle.seek(payload_start + padded_size)
            continue
        elif kind == b"VP8L":
            payload = _read_exact(handle, min(chunk_size, 5), "WebP VP8L is truncated.")
            if chunk_size <= 5 or payload[0] != 0x2F:
                raise ExtractionError("image_format_invalid", "WebP VP8L header is invalid.")
            width = 1 + (((payload[2] & 0x3F) << 8) | payload[1])
            height = 1 + (((payload[4] & 0x0F) << 10) | (payload[3] << 2) | (payload[2] >> 6))
        elif kind == b"VP8 ":
            payload = _read_exact(handle, min(chunk_size, 10), "WebP VP8 is truncated.")
            if chunk_size <= 10 or payload[3:6] != b"\x9d\x01\x2a":
                raise ExtractionError("image_format_invalid", "WebP VP8 frame header is invalid.")
            width = int.from_bytes(payload[6:8], "little") & 0x3FFF
            height = int.from_bytes(payload[8:10], "little") & 0x3FFF
        elif kind == b"ANMF" and canvas is not None and chunk_size > 16:
            width, height = canvas
        else:
            handle.seek(payload_start + padded_size)
            continue
        _validate_dimensions(width, height, limits)
        return "image/webp", "webp", width, height
    raise ExtractionError("image_dimensions_invalid", "WebP has no supported frame dimensions.")


def _validate_image(
    handle: BinaryIO, file_size: int, limits: Limits
) -> tuple[str, str, int, int]:
    handle.seek(0)
    signature = handle.read(12)
    if signature.startswith(PNG_SIGNATURE):
        return _validate_png(handle, file_size, limits)
    if signature.startswith(b"\xff\xd8"):
        return _validate_jpeg(handle, file_size, limits)
    if signature[:4] == b"RIFF" and signature[8:12] == b"WEBP":
        return _validate_webp(handle, file_size, limits)
    raise ExtractionError(
        "image_format_unsupported", "Image is not a supported PNG, JPEG, or WebP file."
    )


def _new_paths(output_dir: Path, call_id: str) -> tuple[Path, Path]:
    stem = _safe_stem(call_id)
    for _ in range(32):
        token = secrets.token_hex(8)
        part = output_dir / f".{stem}-{token}.part"
        final_stem = output_dir / f"{stem}-{token}"
        candidates = (
            Path(f"{final_stem}.png"),
            Path(f"{final_stem}.jpg"),
            Path(f"{final_stem}.webp"),
        )
        if not part.exists() and not any(path.exists() for path in candidates):
            return part, final_stem
    raise ExtractionError("output_collision", "Could not allocate a unique output name.")


def _open_part(path: Path) -> BinaryIO:
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
    return os.fdopen(descriptor, "w+b")


def _stage_saved_image(
    call_id: str,
    source_path: Path,
    output_dir: Path,
    line: int | None,
    total_size: int,
    limits: Limits,
) -> StagedImage:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        source_descriptor = os.open(source_path, flags)
    except OSError as error:
        raise ExtractionError(
            "saved_image_unavailable", "Generated image savedPath cannot be opened safely."
        ) from error

    part_path, final_stem = _new_paths(output_dir, call_id)
    try:
        source_info = os.fstat(source_descriptor)
        if not stat.S_ISREG(source_info.st_mode):
            raise ExtractionError(
                "saved_image_invalid", "Generated image savedPath is not a regular file."
            )
        if source_info.st_size > limits.max_image_bytes:
            raise ExtractionError(
                "image_size_exceeded", f"Image {call_id} exceeds the per-image byte limit."
            )
        if total_size + source_info.st_size > limits.max_total_bytes:
            raise ExtractionError(
                "total_size_exceeded", "Published images exceed the total byte limit."
            )
        with os.fdopen(source_descriptor, "rb") as source, _open_part(part_path) as target:
            source_descriptor = -1
            digest = hashlib.sha256()
            size = 0
            while True:
                chunk = source.read(FILE_CHUNK_BYTES)
                if not chunk:
                    break
                size += len(chunk)
                if size > limits.max_image_bytes or total_size + size > limits.max_total_bytes:
                    raise ExtractionError("image_size_exceeded", "Image byte limit was exceeded.")
                target.write(chunk)
                digest.update(chunk)
            target.flush()
            os.fsync(target.fileno())
            media_type, extension, width, height = _validate_image(target, size, limits)
        return StagedImage(
            call_id=call_id,
            part_path=part_path,
            final_path=Path(f"{final_stem}.{extension}"),
            media_type=media_type,
            width=width,
            height=height,
            size=size,
            sha256=digest.hexdigest(),
            source="saved_path",
            line=line,
        )
    except BaseException:
        part_path.unlink(missing_ok=True)
        raise
    finally:
        if source_descriptor >= 0:
            os.close(source_descriptor)


def _decoded_length(encoded: str) -> int:
    length = len(encoded)
    if length == 0 or length % 4 != 0:
        raise ExtractionError("base64_invalid", "Image result is not canonical padded Base64.")
    padding = 2 if encoded.endswith("==") else 1 if encoded.endswith("=") else 0
    return (length // 4) * 3 - padding


def _stage_base64_image(
    call_id: str,
    encoded: str,
    output_dir: Path,
    line: int,
    total_size: int,
    limits: Limits,
) -> StagedImage:
    expected_size = _decoded_length(encoded)
    if expected_size > limits.max_image_bytes:
        raise ExtractionError(
            "image_size_exceeded", f"Image {call_id} exceeds the per-image byte limit."
        )
    if total_size + expected_size > limits.max_total_bytes:
        raise ExtractionError("total_size_exceeded", "Published images exceed the total byte limit.")

    part_path, final_stem = _new_paths(output_dir, call_id)
    try:
        with _open_part(part_path) as target:
            digest = hashlib.sha256()
            written = 0
            for offset in range(0, len(encoded), BASE64_CHUNK_CHARS):
                chunk = encoded[offset : offset + BASE64_CHUNK_CHARS]
                try:
                    decoded = base64.b64decode(chunk, validate=True)
                except (binascii.Error, ValueError) as error:
                    raise ExtractionError(
                        "base64_invalid", "Image result contains invalid Base64."
                    ) from error
                target.write(decoded)
                digest.update(decoded)
                written += len(decoded)
            if written != expected_size:
                raise ExtractionError("base64_invalid", "Decoded image length is inconsistent.")
            target.flush()
            os.fsync(target.fileno())
            media_type, extension, width, height = _validate_image(target, written, limits)
        return StagedImage(
            call_id=call_id,
            part_path=part_path,
            final_path=Path(f"{final_stem}.{extension}"),
            media_type=media_type,
            width=width,
            height=height,
            size=written,
            sha256=digest.hexdigest(),
            source="base64",
            line=line,
        )
    except BaseException:
        part_path.unlink(missing_ok=True)
        raise


def _fsync_directory(directory: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    try:
        descriptor = os.open(directory, flags)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)


def _cleanup(staged: Iterable[StagedImage], committed: Iterable[Path] = ()) -> None:
    directories: set[Path] = set()
    for image in staged:
        directories.add(image.part_path.parent)
        image.part_path.unlink(missing_ok=True)
    for path in committed:
        directories.add(path.parent)
        path.unlink(missing_ok=True)
    for directory in directories:
        _fsync_directory(directory)


def _prepare_output_dir(output_dir: Path) -> Path:
    output_dir = output_dir.expanduser().resolve()
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise ExtractionError(
            "output_create_failed", f"Cannot create output directory: {output_dir}"
        ) from error
    if not output_dir.is_dir():
        raise ExtractionError("output_invalid", f"Output path is not a directory: {output_dir}")
    return output_dir


def _commit(staged: list[StagedImage], output_dir: Path) -> list[dict[str, Any]]:
    committed: list[Path] = []
    try:
        for image in staged:
            if image.final_path.exists():
                raise ExtractionError("output_collision", "A reserved output path already exists.")
            os.replace(image.part_path, image.final_path)
            committed.append(image.final_path)
        _fsync_directory(output_dir)
    except BaseException:
        _cleanup(staged, committed)
        raise

    results: list[dict[str, Any]] = []
    for index, image in enumerate(staged, start=1):
        target = f"<{image.final_path}>"
        markdown = f"![Generated image {index}]({target})\n\n[Download image {index}]({target})"
        results.append(
            {
                "ok": True,
                "call_id": image.call_id,
                "path": str(image.final_path),
                "media_type": image.media_type,
                "width": image.width,
                "height": image.height,
                "bytes": image.size,
                "sha256": image.sha256,
                "source": image.source,
                "line": image.line,
                "markdown": markdown,
            }
        )
    return results


def publish_saved_paths(
    saved_paths: Sequence[Path], output_dir: Path, limits: Limits
) -> list[dict[str, Any]]:
    if len(saved_paths) > limits.max_images:
        raise ExtractionError("image_count_exceeded", "Image count exceeds the configured limit.")
    staged: list[StagedImage] = []
    total_size = 0
    try:
        for index, source_path in enumerate(saved_paths, start=1):
            source_path = source_path.expanduser()
            if not source_path.is_absolute():
                raise ExtractionError("saved_path_invalid", "--saved-path must be absolute.")
            call_id = f"saved-{index}-{source_path.stem}"
            image = _stage_saved_image(
                call_id, source_path, output_dir, None, total_size, limits
            )
            staged.append(image)
            total_size += image.size
        return _commit(staged, output_dir)
    except BaseException:
        _cleanup(staged)
        raise


def publish_session(
    session: Path,
    output_dir: Path,
    requested_call_ids: Sequence[str],
    limits: Limits,
) -> list[dict[str, Any]]:
    requested = {call_id.strip() for call_id in requested_call_ids if call_id.strip()}
    if len(requested) != len(requested_call_ids):
        raise ExtractionError("call_id_invalid", "--call-id values must be non-empty and unique.")

    staged: list[StagedImage] = []
    staged_ids: set[str] = set()
    discovered_ids: set[str] = set()
    saved_errors: dict[str, ExtractionError] = {}
    total_size = 0
    try:
        # First pass: publish savedPath artifacts and only note Base64 candidates.
        for line_number, record in _iter_jsonl(session, limits.max_jsonl_line_bytes):
            for item_index, item in enumerate(_iter_image_items(record), start=1):
                if not _is_completed(item):
                    continue
                call_id = _call_id(item, f"line-{line_number}-{item_index}")
                if requested and call_id not in requested:
                    continue
                try:
                    saved_path = _saved_path(item)
                except ExtractionError as error:
                    saved_path = None
                    saved_errors[call_id] = error
                    discovered_ids.add(call_id)
                result = item.get("result")
                if saved_path is None and not (isinstance(result, str) and result):
                    continue
                discovered_ids.add(call_id)
                if saved_path is None or call_id in staged_ids:
                    continue
                if len(staged) >= limits.max_images:
                    raise ExtractionError(
                        "image_count_exceeded", "Image count exceeds the configured limit."
                    )
                try:
                    image = _stage_saved_image(
                        call_id, saved_path, output_dir, line_number, total_size, limits
                    )
                except ExtractionError as error:
                    saved_errors[call_id] = error
                    continue
                staged.append(image)
                staged_ids.add(call_id)
                total_size += image.size

        # Second pass: decode legacy results only for calls without a usable savedPath.
        needed = (requested or discovered_ids) - staged_ids
        if needed:
            for line_number, record in _iter_jsonl(session, limits.max_jsonl_line_bytes):
                for item_index, item in enumerate(_iter_image_items(record), start=1):
                    if not _is_completed(item):
                        continue
                    call_id = _call_id(item, f"line-{line_number}-{item_index}")
                    if call_id not in needed or call_id in staged_ids:
                        continue
                    result = item.get("result")
                    if result is None:
                        continue
                    if not isinstance(result, str):
                        raise ExtractionError(
                            "image_result_invalid", "Generated image result must be a Base64 string."
                        )
                    if len(staged) >= limits.max_images:
                        raise ExtractionError(
                            "image_count_exceeded", "Image count exceeds the configured limit."
                        )
                    image = _stage_base64_image(
                        call_id, result, output_dir, line_number, total_size, limits
                    )
                    staged.append(image)
                    staged_ids.add(call_id)
                    total_size += image.size

        missing = (requested or discovered_ids) - staged_ids
        if missing:
            missing_id = sorted(missing)[0]
            if missing_id in saved_errors:
                raise saved_errors[missing_id]
            raise ExtractionError(
                "call_id_not_found", f"No completed image result found for call ID: {missing_id}"
            )
        if not staged:
            raise ExtractionError("image_not_found", "No completed generated image was found.")
        return _commit(staged, output_dir)
    except BaseException:
        _cleanup(staged)
        raise


def run(arguments: argparse.Namespace, environ: Mapping[str, str]) -> dict[str, Any]:
    output_dir = _prepare_output_dir(arguments.output_dir)
    limits = Limits(
        max_image_bytes=arguments.max_image_bytes,
        max_total_bytes=arguments.max_total_bytes,
        max_jsonl_line_bytes=arguments.max_jsonl_line_bytes,
        max_images=arguments.max_images,
        max_dimension=arguments.max_dimension,
        max_pixels=arguments.max_pixels,
    )
    if arguments.saved_path:
        if arguments.call_id or arguments.session is not None:
            raise ExtractionError(
                "arguments_invalid",
                "--session and --call-id cannot be combined with --saved-path.",
            )
        images = publish_saved_paths(arguments.saved_path, output_dir, limits)
        session: str | None = None
    else:
        session_path = resolve_session(arguments.session, environ)
        images = publish_session(session_path, output_dir, arguments.call_id, limits)
        session = str(session_path)
    return {
        "ok": True,
        "session": session,
        "output_dir": str(output_dir),
        "image_count": len(images),
        "total_bytes": sum(image["bytes"] for image in images),
        "images": images,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    try:
        arguments = parser.parse_args(argv)
        payload = run(arguments, os.environ)
        status = 0
    except ExtractionError as error:
        payload = {"ok": False, "error": {"code": error.code, "message": error.message}}
        status = 1
    except (OSError, ValueError):
        payload = {
            "ok": False,
            "error": {"code": "extraction_failed", "message": "Unexpected extraction failure."},
        }
        status = 1
    try:
        print(json.dumps(payload, ensure_ascii=True, separators=(",", ":")))
    except BrokenPipeError:
        return 1
    return status


if __name__ == "__main__":
    raise SystemExit(main())
