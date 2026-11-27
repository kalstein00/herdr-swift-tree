"""Create and enumerate cross-platform fixtures for the Files comparison."""

import argparse
import os
from pathlib import Path


SIZES = (1_000, 10_000, 100_000, 1_000_000)
DEPTH = 12
FILES_PER_BATCH = 1_000


def create_files(folder: Path, first: int, stop: int) -> None:
    for number in range(first, stop):
        (folder / f"row-{number:07d}.txt").touch(exist_ok=False)


def create_fixture(root: Path, shape: str, count: int) -> Path:
    case = root / f"{shape}-{count:07d}"
    case.mkdir(parents=True)

    if shape == "wide":
        target = case / "target"
        target.mkdir()
        create_files(target, 1, count + 1)
        return target

    directory = case
    for level in range(DEPTH):
        first = count * level // DEPTH + 1
        stop = count * (level + 1) // DEPTH + 1
        for batch_start in range(first, stop, FILES_PER_BATCH):
            batch = directory / f"batch-{batch_start:07d}"
            batch.mkdir()
            create_files(batch, batch_start, min(batch_start + FILES_PER_BATCH, stop))
        if level < DEPTH - 1:
            directory = directory / f"d{level + 1:02d}"
            directory.mkdir()

    return directory / f"batch-{first:07d}"


def print_listing(folder: Path) -> None:
    with os.scandir(folder) as entries:
        rows = sorted((not entry.is_dir(), entry.name) for entry in entries)
    for is_file, name in rows:
        print(f"{'file' if is_file else 'dir'}\t{name}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="create one case in a new directory")
    create.add_argument("root", type=Path)
    create.add_argument("shape", choices=("wide", "deep"))
    create.add_argument("count", type=int, choices=SIZES)
    listing = commands.add_parser("list", help="enumerate one folder on its host")
    listing.add_argument("folder", type=Path)
    args = parser.parse_args()

    if args.command == "create":
        print(create_fixture(args.root, args.shape, args.count))
    else:
        print_listing(args.folder)


if __name__ == "__main__":
    main()
