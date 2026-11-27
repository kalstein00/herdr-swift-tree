"""Assert ordered labels in a real Windows Herdr panel capture."""

import argparse
import asyncio
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

from PIL import Image
from winrt.windows.graphics.imaging import BitmapDecoder
from winrt.windows.media.ocr import OcrEngine
from winrt.windows.storage import StorageFile


async def recognize_panel(frame: Path, crop: list[int]) -> str:
    x, y, width, height = crop
    with TemporaryDirectory() as temp:
        panel = Path(temp) / "panel.png"
        with Image.open(frame) as bitmap:
            if min(x, y) < 0 or min(width, height) <= 0:
                raise ValueError("invalid panel crop")
            if x + width > bitmap.width or y + height > bitmap.height:
                raise ValueError("panel crop extends outside the captured window")
            bitmap.crop((x, y, x + width, y + height)).save(panel)

        engine = OcrEngine.try_create_from_user_profile_languages()
        if engine is None:
            raise RuntimeError("Windows OCR has no installed profile language")
        source = await StorageFile.get_file_from_path_async(str(panel))
        with await source.open_read_async() as stream:
            decoder = await BitmapDecoder.create_async(stream)
            with await decoder.get_software_bitmap_async() as bitmap:
                result = await engine.recognize_async(bitmap)
        return "\n".join(line.text for line in result.lines)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frame", type=Path)
    parser.add_argument("labels", nargs="+")
    parser.add_argument("--crop", type=int, nargs=4, required=True)
    parser.add_argument("--exclude", action="append", default=[])
    args = parser.parse_args()

    text = asyncio.run(recognize_panel(args.frame, args.crop))
    print(text)
    cursor = 0
    normalized = text.casefold()
    for label in args.exclude:
        if label.casefold() in normalized:
            parser.exit(1, f"Unexpected panel label: {label}\n")
    for label in args.labels:
        match = normalized.find(label.casefold(), cursor)
        if match < 0:
            parser.exit(1, f"Missing or out-of-order panel label: {label}\n")
        cursor = match + len(label)


if __name__ == "__main__":
    main()
