"""Check the open and closed frames of the native alpha.js click journey."""

import argparse
import asyncio
from pathlib import Path

from PIL import Image

from assert_herdr_panel import recognize_panel


async def verify(opened: Path, closed: Path) -> None:
    # 1600 × 1025 frame with the default right pane. See the fixture in the
    # Windows UI verification guide for row order and the exact user actions.
    header = [1140, 552, 440, 42]
    body = [1138, 594, 425, 120]
    first_row = [1140, 121, 230, 35]
    opened_header = await recognize_panel(opened, header, 2)
    opened_body = await recognize_panel(opened, body, 2)
    if "alpha.js" not in opened_header.casefold() or "ALPHA 001" not in opened_body:
        raise ValueError("Fixture error: alpha.js preview was not open before close")

    closed_header = await recognize_panel(closed, header, 2)
    closed_body = await recognize_panel(closed, body, 2)
    if "read-only" in closed_header.casefold() or "ALPHA 001" in closed_body:
        raise ValueError("Close left the inline preview visible")

    closed_row = await recognize_panel(closed, first_row, 2)
    if "alpha.js" not in closed_row.casefold():
        raise ValueError("The selected file disappeared from the tree")

    with Image.open(opened) as before, Image.open(closed) as after:
        selection = (1480, 139)
        next_row = (1480, 174)
        selected_color = before.getpixel(selection)
        if selected_color == before.getpixel(next_row):
            raise ValueError("Fixture error: alpha.js was not selected before close")
        if after.getpixel(selection) != selected_color:
            raise ValueError("Close changed the selected row")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("opened", type=Path)
    parser.add_argument("closed", type=Path)
    args = parser.parse_args()
    try:
        asyncio.run(verify(args.opened, args.closed))
    except ValueError as error:
        parser.exit(1, f"{error}\n")
    print("PASS: the preview closed and alpha.js stayed selected")


if __name__ == "__main__":
    main()
