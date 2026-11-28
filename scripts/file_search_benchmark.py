"""Measure Ctrl+P results by matching actual Windows Graphics Capture frames."""

import argparse
from ctypes import byref, wintypes
import json
from pathlib import Path
from threading import Condition
import time

import cv2
from windows_capture import WindowsCapture

from preview_benchmark import focus, u


def send(chords):
    for chord in chords:
        for key in chord:
            u.keybd_event(key, 0, 0, 0)
        for key in reversed(chord):
            u.keybd_event(key, 0, 2, 0)
        time.sleep(0.015)


def typing(text):
    return [(ord(char),) for char in text.upper()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("hwnd", type=int)
    parser.add_argument("references", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    templates = {}
    for kind in ("first", "ready", "warm"):
        path = args.references / f"measure-{kind}-1.png"
        bitmap = cv2.imread(str(path))
        if bitmap is None or bitmap.shape[:2] != (1025, 1600):
            raise RuntimeError(f"Expected a 1600×1025 reference: {path}")
        templates[kind] = bitmap[143:171, 435:680].copy()

    state = {"target": None, "frame": None}
    changed = Condition()
    capture = WindowsCapture(window_hwnd=args.hwnd, cursor_capture=False)

    @capture.event
    def on_frame_arrived(frame, _controller):
        with changed:
            target = state["target"]
            if target is None or state["frame"] is not None:
                return
            region = frame.frame_buffer[125:192, 413:710, :3]
            score = cv2.matchTemplate(region, templates[target], cv2.TM_CCOEFF_NORMED).max()
            if score > 0.999:
                state["frame"] = (frame.timespan * 100, region.copy())
                changed.notify_all()

    @capture.event
    def on_closed():
        pass

    def observe(target, chords, sample):
        with changed:
            state.update(target=target, frame=None)
        before = time.perf_counter_ns()
        send(chords)
        with changed:
            if not changed.wait_for(lambda: state["frame"] is not None, timeout=35):
                raise RuntimeError(f"No matching {target} frame for trial {sample}.")
            frame_time, pixels = state["frame"]
            state["target"] = None
        if frame_time < before:
            raise RuntimeError(f"The matching {target} frame predates the action.")
        file = f"{target}-{sample}.png"
        if not cv2.imwrite(str(args.output / file), pixels):
            raise RuntimeError(f"Could not save {file}.")
        return {"input_qpc_ns": before, "frame_qpc_ns": frame_time,
                "elapsed_ms": round((frame_time - before) / 1_000_000, 3), "frame": file}

    focus(args.hwnd)
    point = wintypes.POINT(800, 520)
    if not u.ClientToScreen(args.hwnd, byref(point)) or not u.SetCursorPos(point.x, point.y):
        raise RuntimeError("Could not keep the pointer outside the search results.")
    controller = capture.start_free_threaded()
    samples = []
    try:
        for sample in range(1, 4):
            first = observe("first", [(0x11, 0x50), *typing("measureneedlea")], sample)
            observe("ready", [(0x11, 0x41), *typing("zznoentry")], sample)
            warm = observe("warm", [(0x11, 0x41), *typing("refreshproof")], sample)
            samples.append({"trial": sample, "first": first, "warm": warm})
            send([(0x1B,)])
            time.sleep(0.15)
    finally:
        controller.stop()
        controller.wait()
    report = json.dumps(samples, indent=2) + "\n"
    (args.output / "samples.json").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
