"""Measure a real checkout or sync in a disposable SwiftTree fixture."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from threading import Event, Thread
import time

from vcs_fixture import FOLDERS


def clocks() -> dict:
    before = time.perf_counter_ns()
    wall = time.time_ns()
    return {"mono_before_ns": before, "wall_ns": wall, "mono_after_ns": time.perf_counter_ns()}


def emit(event: str, **fields) -> None:
    print(json.dumps({"event": event, **fields}, separators=(",", ":")), flush=True)


def measure(root: Path, output: Path, command: list[str]) -> int:
    dirs = {name: root / name for name in FOLDERS}
    previous = {name: path.stat().st_mtime_ns for name, path in dirs.items()}
    initial = dict(previous)
    samples = []
    stopping = Event()
    sample_error = []
    output.mkdir(parents=True, exist_ok=False)

    def sample() -> None:
        current = {name: path.stat().st_mtime_ns for name, path in dirs.items()}
        changed = {name: stamp for name, stamp in current.items() if stamp != previous[name]}
        if changed:
            observed = clocks()
            if not samples:
                emit("first-change-observed", **observed)
            samples.append({"observed": observed, "directory_mtime_ns": changed})
            previous.update(changed)

    def watch() -> None:
        try:
            while not stopping.wait(0.01):
                sample()
        except OSError as error:
            sample_error.append(error)

    observer = Thread(target=watch)
    with (output / "command.log").open("wb") as log:
        start = clocks()
        emit("command-start", **start)
        observer.start()
        try:
            proc = subprocess.Popen(command, cwd=root, stdout=log, stderr=subprocess.STDOUT)
            code = proc.wait()
            ended = clocks()
            emit("command-exit", code=code, **ended)
        finally:
            stopping.set()
            observer.join()
    if sample_error:
        raise sample_error[0]
    sample()

    final = {name: path.stat().st_mtime_ns for name, path in dirs.items()}
    if code == 0 and any(final[name] <= initial[name] for name in dirs):
        raise RuntimeError("the command did not change the expected directory names in all five branches")
    latest = max(final.values())
    latest_data = max((entry.stat(follow_symlinks=False).st_mtime_ns
                       for path in dirs.values()
                       for entry in _changed_files(path)), default=0)
    result = {"command": command, "root": str(root), "exit_code": code, "start": start, "exit": ended,
              "first_change": samples[0] if samples else None, "last_observed_change": samples[-1] if samples else None,
              "initial_directory_mtime_ns": initial, "final_directory_mtime_ns": final,
              "last_data_write_mtime_ns": latest_data, "last_file_change_wall_ns": max(latest, latest_data)}
    (output / "filesystem.json").write_text(json.dumps({**result, "samples": samples}, indent=2) + "\n")
    emit("filesystem-complete", **result)
    return code


def _changed_files(path: Path):
    with os.scandir(path) as entries:
        for entry in entries:
            if entry.name.startswith(("new-", "old-")) and entry.is_file(follow_symlinks=False):
                yield entry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clock", action="store_true", help="reply with paired clock samples on stdin")
    parser.add_argument("--root", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.clock:
        for _ in sys.stdin:
            emit("clock", **clocks())
        return 0
    command = args.command[1:] if args.command and args.command[0] == "--" else args.command
    if not args.root or not args.output or not command:
        parser.error("--root, --output and a VCS command after -- are required")
    return measure(args.root.resolve(), args.output.resolve(), command)


if __name__ == "__main__":
    raise SystemExit(main())
