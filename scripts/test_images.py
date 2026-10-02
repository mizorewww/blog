# /// script
# requires-python = ">=3.10"
# dependencies = ["Pillow==12.1.0"]
# ///
"""Run with: uv run scripts/test_images.py."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from PIL import Image

spec = importlib.util.spec_from_file_location("prepare_image", Path(__file__).with_name("prepare-image.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Images(unittest.TestCase):
    def test_transparency_resize_cache_and_original(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "screen.png"
            Image.new("RGBA", (2400, 1200), (30, 100, 200, 128)).save(source)
            original = source.read_bytes()
            result = module.prepare(source, root / "cache")
            self.assertEqual((result["width"], result["height"]), (1600, 800))
            with Image.open(result["path"]) as output:
                self.assertEqual(output.getpixel((100, 100))[3], 128)
            self.assertLess(Path(result["path"]).stat().st_size, len(original))
            self.assertEqual(source.read_bytes(), original)
            stamp = Path(result["path"]).stat().st_mtime_ns
            self.assertEqual(module.prepare(source, root / "cache"), result)
            self.assertEqual(Path(result["path"]).stat().st_mtime_ns, stamp)
            Image.new("RGB", (400, 200), "red").save(source)
            self.assertNotEqual(module.prepare(source, root / "cache")["path"], result["path"])

    def test_orientation_and_animation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "photo.jpg"
            exif = Image.Exif()
            exif[274] = 6
            Image.new("RGB", (400, 200), "red").save(source, exif=exif)
            result = module.prepare(source, root / "cache")
            self.assertEqual((result["width"], result["height"]), (200, 400))
            gif = root / "animation.gif"
            Image.new("RGB", (20, 20), "red").save(gif, save_all=True, append_images=[Image.new("RGB", (20, 20), "blue")], duration=100, loop=0)
            result = module.prepare(gif, root / "cache")
            self.assertEqual(gif.read_bytes(), Path(result["path"]).read_bytes())

    def test_small_image_and_invalid_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "tiny.png"
            Image.new("RGB", (1, 1), "red").save(source)
            original = source.read_bytes()
            result = module.prepare(source, root / "cache")
            self.assertLessEqual(Path(result["path"]).stat().st_size, len(original))
            source.write_bytes(b"broken")
            with self.assertRaises(OSError):
                module.prepare(source, root / "cache")


if __name__ == "__main__":
    unittest.main()
