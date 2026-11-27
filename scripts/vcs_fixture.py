"""Create versioned, disposable workspace fixtures and enumerate their final rows."""

import argparse
import json
import os
from pathlib import Path
import stat
import subprocess


OPEN_NAMES = ("A-Open", "B-Open", "C-Open")
FOLDERS = (*OPEN_NAMES, "D-Closed", "E-Closed")
KEPT_FILES = 240


def file_names(prefix: str, count: int):
    return (f"{prefix}-{number:05}.txt" for number in range(1, count + 1))


def materialize(root: Path, stage: str, count: int) -> None:
    if stage == "before":
        root.mkdir(parents=True, exist_ok=True)
        if any(root.iterdir()):
            raise ValueError(f"Expected an empty fixture root: {root}")
        for name in FOLDERS:
            folder = root / name
            folder.mkdir()
            for file in (*file_names("keep", KEPT_FILES), *file_names("old", count)):
                (folder / file).write_bytes(b"SwiftTree synthetic fixture\n")
        return

    # After is used only on the fixture's publisher, never on a measured client.
    for name in FOLDERS:
        folder = root / name
        expected = set(file_names("old", count)) | set(file_names("keep", KEPT_FILES))
        if folder.is_symlink() or set(os.listdir(folder)) != expected:
            raise ValueError(f"Expected the before fixture in {folder}")
    for name in FOLDERS:
        folder = root / name
        for file in file_names("old", count):
            path = folder / file
            if os.name == "nt":
                path.chmod(stat.S_IREAD | stat.S_IWRITE)
            path.unlink()
        for file in file_names("new", count):
            (folder / file).write_bytes(b"SwiftTree synthetic fixture after VCS change\n")


def prepare_git(root: Path, count: int) -> None:
    materialize(root, "before", count)
    environment = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}

    def git(*args: str) -> None:
        subprocess.run(["git", *args], cwd=root, env=environment, check=True,
                       stdout=subprocess.DEVNULL)

    git("init", "--initial-branch=before")
    git("config", "user.name", "SwiftTree fixture")
    git("config", "user.email", "fixture@localhost")
    git("config", "core.autocrlf", "false")
    git("config", "core.fsmonitor", "false")
    git("add", "--", ".")
    git("commit", "-qm", "Before bulk change")
    git("checkout", "-qb", "after")
    materialize(root, "after", count)
    git("add", "-A")
    git("commit", "-qm", "After bulk change")
    git("checkout", "-q", "before")


def inventory(root: Path) -> dict:
    result = {}
    for name in (".", *FOLDERS):
        with os.scandir(root / name) as entries:
            rows = [(entry.name, entry.is_dir(follow_symlinks=False)) for entry in entries]
        result[name] = [{"name": name, "directory": directory} for name, directory in
                        sorted(rows, key=lambda row: (not row[1], row[0].casefold()))]
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("before", "after", "git", "inventory"))
    parser.add_argument("root", type=Path)
    parser.add_argument("--count", type=int, default=6000, help="replaced files in each branch")
    args = parser.parse_args()
    if not 1 <= args.count <= 99_999:
        parser.error("--count must be 1 to 99999")
    if args.operation == "git":
        prepare_git(args.root, args.count)
    elif args.operation == "inventory":
        print(json.dumps(inventory(args.root), separators=(",", ":")))
    else:
        materialize(args.root, args.operation, args.count)


if __name__ == "__main__":
    main()
