"""Check text at the start and end of an oversized file in actual app frames."""

import argparse
import asyncio
from pathlib import Path

from PIL import Image

from assert_herdr_panel import recognize_panel


async def verify(inline: Path, expanded: Path | None, end: Path | None, size: int) -> None:
    # This is the 1600 × 1025 Windows Herdr fixture with its default right pane.
    header = await recognize_panel(inline, [1138, 553, 440, 40], 2)
    if f"{size:08d}" not in header.replace(" ", ""):
        raise ValueError(f"Fixture error: the selected {size}-byte filename is absent: {header!r}")
    body = await recognize_panel(inline, [1138, 595, 425, 110], 2)
    if "TOP SIZE PROOF" not in body:
        raise ValueError(f"Files cannot preview the start of the {size}-byte file: {body!r}")
    if expanded is None or end is None:
        raise ValueError("The file did not open in an owned expanded viewer")

    with Image.open(expanded) as top, Image.open(end) as bottom:
        if top.size != bottom.size:
            raise ValueError("Fixture error: expanded window size changed during verification")
        width, height = top.size
    first = await recognize_panel(expanded, [0, 35, min(540, width), 150], 2)
    last = await recognize_panel(end, [0, height - 180, min(540, width), 175], 2)
    if f"TOP SIZE PROOF {size}" not in first:
        raise ValueError(f"Expanded preview did not open at the start: {first!r}")
    if f"END SIZE PROOF {size}" not in last:
        raise ValueError(f"Expanded preview did not reach the final marker: {last!r}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("size", type=int)
    parser.add_argument("inline", type=Path)
    parser.add_argument("--expanded", type=Path)
    parser.add_argument("--end", type=Path)
    args = parser.parse_args()
    try:
        asyncio.run(verify(args.inline, args.expanded, args.end, args.size))
    except ValueError as error:
        parser.exit(1, f"{error}\n")
    print(f"PASS: native lower preview, expanded first line and final marker for {args.size} bytes")


if __name__ == "__main__":
    main()
