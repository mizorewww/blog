# /// script
# requires-python = ">=3.10"
# dependencies = ["Pillow==12.1.0"]
# ///
"""Build helper: source file -> cached derivative metadata on stdout."""
import hashlib
import io
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps


def prepare(source, cache):
    original = source.read_bytes()
    key = hashlib.sha256(Path(__file__).read_bytes() + original).hexdigest()
    cache.mkdir(parents=True, exist_ok=True)
    manifest = cache / (key + ".json")
    if manifest.exists():
        result = json.loads(manifest.read_text())
        if Path(result["path"]).is_file():
            return result
    with Image.open(io.BytesIO(original)) as image:
        if image.format not in {"JPEG", "PNG", "WEBP", "GIF", "AVIF"}:
            raise ValueError(f"unsupported image format: {image.format}")
        extension = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif", "AVIF": ".avif"}[image.format]
        width, height = image.size
        data = original
        if not getattr(image, "is_animated", False):
            oriented = ImageOps.exif_transpose(image)
            # Retain enough pixels for the reading column on a 2x display.
            if oriented.width > 1600:
                oriented.thumbnail((1600, max(1, round(oriented.height * 1600 / oriented.width))), Image.Resampling.LANCZOS)
            converted = oriented.convert("RGBA" if "A" in oriented.getbands() or "transparency" in oriented.info else "RGB")
            output = io.BytesIO()
            converted.save(output, "WEBP", quality=82, method=6,
                           lossless=image.format in {"PNG", "GIF"},
                           icc_profile=image.info.get("icc_profile", b""))
            # Never publish a larger file just to change its format.
            if len(output.getvalue()) < len(original):
                data, extension = output.getvalue(), ".webp"
                width, height = converted.size
            elif image.getexif().get(274) in {5, 6, 7, 8}:
                width, height = height, width
    target = cache / (key + extension)
    target.write_bytes(data)
    result = {"path": str(target.resolve()), "width": width, "height": height}
    # Phones get a 720px lossy copy through srcset; the full image stays for wide screens.
    if width > 800 and not getattr(image, "is_animated", False):
        with Image.open(target) as full:
            small = full.copy()
        small.thumbnail((720, round(height * 720 / width)), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        small.convert("RGBA" if "A" in small.getbands() else "RGB").save(output, "WEBP", quality=80, method=6)
        if len(output.getvalue()) < len(data):
            small_target = cache / (key + ".720.webp")
            small_target.write_bytes(output.getvalue())
            result["small"] = {"path": str(small_target.resolve()), "width": small.width}
    manifest.write_text(json.dumps(result))
    print(f"image: {source}: {len(original)} -> {len(data)} bytes", file=sys.stderr)
    return result


if __name__ == "__main__":
    print(json.dumps(prepare(Path(sys.argv[1]), Path(sys.argv[2]))))
