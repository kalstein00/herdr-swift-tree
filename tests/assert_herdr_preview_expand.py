"""Check that the native expand action opens the current preview from line one."""

import argparse
import asyncio
from pathlib import Path
import re

from PIL import Image, ImageChops

from assert_herdr_panel import recognize_panel


async def verify(inline: Path, expanded: Path, restored: Path | None) -> None:
    # The documented 1600 × 1025 fixture starts with the default right pane.
    inline_header = await recognize_panel(inline, [1140, 552, 440, 42], 2)
    inline_body = await recognize_panel(inline, [1138, 595, 425, 106], 2)
    if "alpha.js" not in inline_header.casefold() or "ALPHA" not in inline_body:
        raise ValueError("Fixture error: the alpha.js inline preview was not open")
    if "ALPHA 001" in inline_body:
        raise ValueError("Fixture error: the inline preview did not scroll past line one")

    center_title = await recognize_panel(expanded, [161, 119, 165, 37], 3)
    center_line = await recognize_panel(expanded, [172, 165, 370, 40], 2)
    if "alphajs" not in re.sub(r"\W", "", center_title.casefold()) or "ALPHA 001" not in center_line:
        raise ValueError("Expand did not open alpha.js at line one in the center")
    if not re.match(r"\s*1\b", center_line):
        raise ValueError("The first line number was not visible in the expanded preview")

    if restored is not None:
        body = (1138, 595, 1560, 952)
        with Image.open(inline) as before, Image.open(restored) as after:
            if ImageChops.difference(before.crop(body).convert("RGB"), after.crop(body).convert("RGB")).getbbox():
                raise ValueError("Closing the expanded preview changed the inline viewport")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inline", type=Path)
    parser.add_argument("expanded", type=Path)
    parser.add_argument("--restored", type=Path)
    args = parser.parse_args()
    try:
        asyncio.run(verify(args.inline, args.expanded, args.restored))
    except ValueError as error:
        parser.exit(1, f"{error}\n")
    print("PASS: the current inline preview expanded in the center at line one")


if __name__ == "__main__":
    main()
