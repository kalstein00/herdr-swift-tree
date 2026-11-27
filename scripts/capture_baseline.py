"""Log input and changed frames from one synthetic Windows benchmark window."""

import argparse
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import time

import cv2
import numpy
from windows_capture import WindowsCapture


WM_TIMER = 0x0113
WH_MOUSE_LL = 14
WH_KEYBOARD_LL = 13
MOUSE_ACTIONS = {0x0201: "click", 0x020A: "wheel"}
NAVIGATION_KEYS = {0x0D: "enter", 0x23: "end", 0x24: "home", 0x28: "down"}
HookCallback = ctypes.WINFUNCTYPE(
    ctypes.c_ssize_t, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM
)


def watch_input(hwnd: int, duration_ms: int, events: list[dict], navigation_keys: bool) -> None:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.SetWindowsHookExW.argtypes = (
        ctypes.c_int, HookCallback, wintypes.HINSTANCE, wintypes.DWORD
    )
    user32.SetWindowsHookExW.restype = wintypes.HANDLE
    user32.CallNextHookEx.argtypes = (
        wintypes.HANDLE, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM
    )
    user32.CallNextHookEx.restype = ctypes.c_ssize_t
    user32.UnhookWindowsHookEx.argtypes = (wintypes.HANDLE,)
    user32.SetTimer.argtypes = (wintypes.HWND, ctypes.c_size_t, wintypes.UINT, ctypes.c_void_p)
    user32.SetTimer.restype = ctypes.c_size_t
    user32.KillTimer.argtypes = (wintypes.HWND, ctypes.c_size_t)

    @HookCallback
    def observe_mouse(code, event, data):
        action = MOUSE_ACTIONS.get(event)
        if code >= 0 and action and user32.GetForegroundWindow() == hwnd:
            events.append({"action": action, "qpc_ns": time.perf_counter_ns()})
        return user32.CallNextHookEx(None, code, event, data)

    @HookCallback
    def observe_keyboard(code, event, data):
        if code >= 0 and event == 0x0100 and user32.GetForegroundWindow() == hwnd:
            key = ctypes.cast(data, ctypes.POINTER(wintypes.DWORD)).contents.value
            if key in NAVIGATION_KEYS:
                events.append({"action": NAVIGATION_KEYS[key], "qpc_ns": time.perf_counter_ns()})
        return user32.CallNextHookEx(None, code, event, data)

    mouse_hook = user32.SetWindowsHookExW(WH_MOUSE_LL, observe_mouse, None, 0)
    if not mouse_hook:
        raise ctypes.WinError(ctypes.get_last_error())

    keyboard_hook = None
    try:
        if navigation_keys:
            keyboard_hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, observe_keyboard, None, 0)
            if not keyboard_hook:
                raise ctypes.WinError(ctypes.get_last_error())
        timer = user32.SetTimer(None, 0, duration_ms, None)
        if not timer:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            msg = wintypes.MSG()
            print("Capturing benchmark window. Perform the user journey now.", flush=True)
            while True:
                result = user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
                if result == -1:
                    raise ctypes.WinError(ctypes.get_last_error())
                if not result or (msg.message == WM_TIMER and msg.wParam == timer):
                    break
                user32.DispatchMessageW(ctypes.byref(msg))
        finally:
            user32.KillTimer(None, timer)
    finally:
        if keyboard_hook:
            user32.UnhookWindowsHookEx(keyboard_hook)
        user32.UnhookWindowsHookEx(mouse_hook)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("hwnd", type=int)
    parser.add_argument("output", type=Path)
    parser.add_argument("--seconds", type=int, default=15)
    parser.add_argument("--navigation-keys", action="store_true", help="also record Home, End, Down and Enter in the benchmark window")
    parser.add_argument("--crop", type=int, nargs=4, required=True, metavar=("X", "Y", "WIDTH", "HEIGHT"))
    args = parser.parse_args()
    x, y, width, height = args.crop
    if min(x, y) < 0 or min(width, height) <= 0:
        parser.error("crop origin must be nonnegative and dimensions must be positive")
    if not 1 <= args.seconds <= 60:
        parser.error("capture duration must be 1 to 60 seconds")
    args.output.mkdir(parents=True)

    frames = []
    events = []
    invalid_crop = False
    capture = WindowsCapture(window_hwnd=args.hwnd, cursor_capture=False)

    @capture.event
    def on_frame_arrived(frame, control):
        nonlocal invalid_crop
        region = frame.frame_buffer[y:y + height, x:x + width, :3]
        if region.shape[:2] != (height, width):
            invalid_crop = True
            control.stop()
            return
        if not frames or not numpy.array_equal(region, frames[-1][1]):
            frames.append((frame.timespan * 100, region.copy()))

    @capture.event
    def on_closed():
        pass

    controller = capture.start_free_threaded()
    try:
        watch_input(args.hwnd, args.seconds * 1_000, events, args.navigation_keys)
    finally:
        controller.stop()
        controller.wait()

    if invalid_crop or not frames:
        raise RuntimeError("target frames did not cover the crop; verify the window handle and crop")
    metadata = []
    for index, (timestamp, pixels) in enumerate(frames):
        name = f"frame-{index:04d}.png"
        if not cv2.imwrite(str(args.output / name), pixels):
            raise RuntimeError(f"could not save {name}")
        metadata.append({"file": name, "qpc_ns": timestamp})
    result = {"hwnd": args.hwnd, "crop": args.crop, "inputs": events, "frames": metadata}
    (args.output / "events.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Recorded {len(events)} input events and {len(frames)} changed frames.")


if __name__ == "__main__":
    main()
