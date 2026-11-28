"""Measure actual Files clicks to the first matching composed WGC viewport."""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import math
from pathlib import Path
import statistics
import subprocess
from threading import Condition
import time

import cv2
import numpy as np
from windows_capture import WindowsCapture

u = c.WinDLL('user32', use_last_error=True)
u.SetThreadDpiAwarenessContext.argtypes = (w.HANDLE,)
u.SetThreadDpiAwarenessContext(w.HANDLE(-4))
u.GetForegroundWindow.restype = w.HWND
u.SetForegroundWindow.argtypes = (w.HWND,)
u.GetWindowThreadProcessId.argtypes = (w.HWND, c.POINTER(w.DWORD))
u.GetWindowThreadProcessId.restype = w.DWORD
u.AttachThreadInput.argtypes = (w.DWORD, w.DWORD, w.BOOL)
u.WindowFromPoint.argtypes = (w.POINT,)
u.WindowFromPoint.restype = w.HWND
u.GetAncestor.argtypes = (w.HWND, w.UINT)
u.GetAncestor.restype = w.HWND
u.ClientToScreen.argtypes = (w.HWND, c.POINTER(w.POINT))
u.mouse_event.argtypes = (w.DWORD, w.DWORD, w.DWORD, w.DWORD, c.c_size_t)

dwm = c.WinDLL('dwmapi', use_last_error=True)
dwm.DwmGetWindowAttribute.argtypes = (w.HWND, w.DWORD, c.c_void_p, w.DWORD)
u.GetWindow.argtypes = (w.HWND, w.UINT)
u.GetWindow.restype = w.HWND
u.IsWindowEnabled.argtypes = (w.HWND,)
u.IsWindowEnabled.restype = w.BOOL
u.keybd_event.argtypes = (w.BYTE, w.BYTE, w.DWORD, c.c_size_t)
u.MonitorFromWindow.argtypes = (w.HWND, w.DWORD)
u.MonitorFromWindow.restype = w.HANDLE


class MonitorInfo(c.Structure):
    _fields_ = [('size', w.DWORD), ('bounds', w.RECT), ('work', w.RECT), ('flags', w.DWORD)]


u.GetMonitorInfoW.argtypes = (w.HANDLE, c.POINTER(MonitorInfo))


def native_events(trace_path, samples, mode, shape):
    frequency = c.c_int64()
    if not c.WinDLL("kernel32").QueryPerformanceFrequency(c.byref(frequency)):
        raise RuntimeError("QueryPerformanceFrequency failed")
    events = []
    for line in trace_path.read_text(encoding="ascii").splitlines():
        fields = line.split(maxsplit=2)
        if len(fields) == 3:
            tick, pid, name = fields
            events.append((int(tick) * 1_000_000_000 // frequency.value, int(pid), name))
    for sample in samples:
        start = sample["input_qpc_ns"]
        end = sample["dismiss_qpc_ns"]
        interval = [event for event in events if start <= event[0] <= end]
        views = [(pid, name) for _, pid, name in interval if name.startswith("show/")]
        if len(views) != 1:
            raise RuntimeError(f"Expected one native open for measured input, got {views}")
        host, opened = views[0]
        started = any(pid == host and name == "prewarm/start" for _, pid, name in interval)
        if mode == "cold":
            if not started:
                raise RuntimeError("A cold sample reused an already running preview host")
        elif opened != "show/ready" or started:
            raise RuntimeError("A warm sample unexpectedly waited for preview initialization")
        phases = {
            name: round((qpc - start) / 1e6, 3)
            for qpc, pid, name in interval
            if pid == host and name.startswith(("show/", "prewarm/", "document/", "markdown/"))
        }
        began = phases.get("markdown/attached" if shape == "design" else "document/prefix")
        if began is None or sample["body"]["latency_ms"] < began - 8:
            raise RuntimeError("The matching frame predates the current document")
        sample["native"] = {"host_pid": host, "phases_ms_after_click": phases}


def get_rect(hwnd):
    rect = w.RECT()
    if dwm.DwmGetWindowAttribute(hwnd, 9, c.byref(rect), c.sizeof(rect)) != 0:
        raise RuntimeError('DWM did not supply the viewer rectangle')
    return rect.left, rect.top, rect.right, rect.bottom


def monitor_rect(owner):
    monitor = u.MonitorFromWindow(owner, 2)
    info = MonitorInfo(c.sizeof(MonitorInfo))
    if not u.GetMonitorInfoW(monitor, c.byref(info)):
        raise RuntimeError('Could not locate the owner monitor')
    r = info.bounds
    return r.left, r.top, r.right, r.bottom


def focus(hwnd):
    if u.GetForegroundWindow() == hwnd:
        return
    u.SetForegroundWindow(hwnd)
    if u.GetForegroundWindow() == hwnd:
        return
    thread = c.WinDLL("kernel32").GetCurrentThreadId()
    previous = u.GetWindowThreadProcessId(u.GetForegroundWindow(), None)
    attached = previous and previous != thread and u.AttachThreadInput(thread, previous, True)
    try:
        u.SetForegroundWindow(hwnd)
    finally:
        if attached:
            u.AttachThreadInput(thread, previous, False)
    if u.GetForegroundWindow() != hwnd:
        raise RuntimeError('Could not focus the dedicated benchmark window')


def click(hwnd, position):
    point = w.POINT(*position)
    if not u.ClientToScreen(hwnd, c.byref(point)):
        raise c.WinError(c.get_last_error())
    for _ in range(3):
        focus(hwnd)
        if u.GetAncestor(u.WindowFromPoint(point), 2) != hwnd:
            raise RuntimeError('The dedicated input point is covered or outside its window')
        if not u.SetCursorPos(point.x, point.y):
            raise c.WinError(c.get_last_error())
        time.sleep(.03)
        if u.GetForegroundWindow() == hwnd and u.GetAncestor(u.WindowFromPoint(point), 2) == hwnd:
            break
    else:
        raise RuntimeError('The dedicated window lost focus before input')
    start = time.perf_counter_ns()
    u.mouse_event(2, 0, 0, 0, 0)
    u.mouse_event(4, 0, 0, 0, 0)
    return start

def escape(owner):
    viewer = u.GetForegroundWindow()
    if u.GetWindow(viewer, 4) != owner:
        raise RuntimeError('Native input cannot target an unrelated window')
    u.keybd_event(27, 0, 0, 0)
    u.keybd_event(27, 0, 2, 0)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if u.GetForegroundWindow() == owner and u.IsWindowEnabled(owner):
            return
        time.sleep(0.015)
    raise RuntimeError('Esc did not restore the owner')


def mask(image, box):
    x1, y1, x2, y2 = box
    gray = cv2.cvtColor(image[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    return np.uint8(gray < 160) * 255


def score(image, box, reference):
    return float(cv2.matchTemplate(mask(image, box), reference, cv2.TM_SQDIFF_NORMED).min())


def load(path):
    image = cv2.imread(str(path))
    if image is None:
        raise ValueError(f'Missing reference image: {path}')
    return image


def percentiles(values):
    return {'n': len(values), 'p50_ms': round(statistics.median(values), 3),
            'p95_ms': round(sorted(values)[math.ceil(.95 * len(values)) - 1], 3)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('owner', type=int)
    p.add_argument('output', type=Path)
    p.add_argument('references', type=Path)
    p.add_argument('--shape', choices=('source', 'design'), required=True)
    p.add_argument('--mode', choices=('cold', 'different', 'reopen'), required=True)
    p.add_argument('--count', type=int, default=20)
    p.add_argument('--monitor', type=int, default=1)
    p.add_argument('--profile', type=Path, required=True)
    p.add_argument('--trace', type=Path, required=True)
    p.add_argument('--ssh', action='store_true')
    args = p.parse_args()
    if args.count < 1:
        p.error("--count must be positive")

    args.output.mkdir(parents=True, exist_ok=True)
    focus(args.owner)
    references = {x: load(args.references / f'{args.shape}-{x}.png') for x in 'AB'}
    if args.shape == 'source':
        body_box = (77, 81, 320, 99)
        search_box = (26, 76, 385, 105)
        rows = {'A': 139, 'B': 174}
    else:
        body_box = (67, 180, 281, 197)
        search_box = (56, 175, 360, 206)
        rows = {'A': 209, 'B': 244}
    text = {variant: mask(image, body_box) for variant, image in references.items()}
    # The variable margin lets the sum move when the diagram acquires its actual layout.
    equation = mask(references['A'], (587, 382, 686, 448)) if args.shape == 'design' else None
    left, top, right, bottom = monitor_rect(args.owner)
    capture = WindowsCapture(cursor_capture=False, monitor_index=args.monitor)
    state = Condition()
    ready = False
    began = 0
    variant = 'A'
    matches = {}
    frame_count = 0
    selected = None

    @capture.event
    def on_closed():
        pass

    @capture.event
    def on_frame_arrived(frame, control):
        nonlocal ready, frame_count
        stamp = frame.timespan * 100
        pixels = frame.frame_buffer[:, :, :3]
        with state:
            if pixels.shape[:2] != (bottom - top, right - left):
                return
            ready = True
            viewer = u.GetForegroundWindow()
            if not began or stamp <= began or u.GetWindow(viewer, 4) != args.owner:
                state.notify_all()
                return
            x, y, x2, y2 = get_rect(viewer)
            if not (left <= x < x2 <= right and top <= y < y2 <= bottom):
                return
            body = pixels[y-top:y2-top, x-left:x2-left]
            if body.shape != references[variant].shape:
                return
            frame_count += 1
            if 'body' not in matches:
                metric = score(body, search_box, text[variant])
                other = score(body, search_box, text['B' if variant == 'A' else 'A'])
                if metric < .22 and metric < other - .005:
                    matches['body'] = (stamp, body.copy(), metric)
                elif args.mode == 'different' and other < .22 and other < metric - .005:
                    matches.setdefault('previous-file', (stamp, body.copy(), other))
            if equation is not None and 'body' in matches:
                if 'mermaid' not in matches:
                    diagram = body[244:370, 60:480]
                    purple = np.count_nonzero(np.all(diagram == (255, 236, 236), axis=2))
                    if purple > 5500:
                        matches['mermaid'] = (stamp, body.copy(), int(purple))
                if 'math' not in matches:
                    eq_score = score(body, (555, 350, 740, 492), equation)
                    if eq_score < .14:
                        matches['math'] = (stamp, body.copy(), eq_score)
            state.notify_all()

    def input_sample(target):
        nonlocal began, variant, matches, frame_count, selected
        if selected != target:
            click(args.owner, (1200, rows[target]))
            time.sleep(.65 if args.ssh else .48)
            selected = target
        if args.mode == 'cold':
            binary = args.profile / 'mods/swifttree/swifttree-windows.exe'
            subprocess.run([str(binary), 'stop-preview', str(args.profile.absolute())],
                           check=True, timeout=12, creationflags=subprocess.CREATE_NO_WINDOW)
        with state:
            variant = target
            matches = {}
            frame_count = 0
            began = click(args.owner, (1500, 574))
            needed = ('body', 'math', 'mermaid') if equation is not None else ('body',)
            if not state.wait_for(lambda: all(key in matches for key in needed), timeout=16):
                raise RuntimeError(f'Missing first frames for {target}: {list(matches)}, frames={frame_count}')
            if 'previous-file' in matches:
                cv2.imwrite(str(args.output / 'unexpected-previous-file.png'), matches['previous-file'][1])
                raise RuntimeError('A previous-file frame appeared before the selected file')
            stamps = {key: {'frame_qpc_ns': stamp, 'latency_ms': round((stamp - began) / 1e6, 3),
                            'match': quality} for key, (stamp, _, quality) in matches.items()}
            sample = {'variant': target, 'input_qpc_ns': began, 'frames_examined': frame_count, **stamps}
            return sample, dict(matches)

    controller = capture.start_free_threaded()
    samples = []
    try:
        with state:
            if not state.wait_for(lambda: ready, timeout=5):
                raise RuntimeError('No primary monitor frame or wrong monitor geometry')
        if args.mode != 'cold':
            input_sample('A')
            escape(args.owner)
            time.sleep(.65 if args.ssh else .25)
        for index in range(args.count):
            target = 'B' if args.mode == 'different' and index % 2 == 0 else 'A'
            sample, captures = input_sample(target)
            for name, (_, image, _) in captures.items():
                if index in (0, args.count - 1):
                    cv2.imwrite(str(args.output / f'{index+1:02d}-{name}.png'), image)
            samples.append(sample)
            print(index + 1, target, {key: value['latency_ms'] for key, value in sample.items()
                                    if isinstance(value, dict)}, flush=True)
            if args.shape == 'source':
                time.sleep(.12)
            sample["dismiss_qpc_ns"] = time.perf_counter_ns()
            escape(args.owner)
            time.sleep(.65 if args.ssh else .25)
    finally:
        controller.stop()
        controller.wait()
        if samples:
            native_events(args.trace, samples, args.mode, args.shape)
            metrics = {key: percentiles([sample[key]['latency_ms'] for sample in samples])
                       for key in ('body', 'math', 'mermaid') if key in samples[0]}
            result = {'mode': args.mode, 'shape': args.shape, 'target': 'SSH' if args.ssh else 'NTFS',
                      'owner': args.owner, 'trace': str(args.trace), 'statistics': metrics, 'samples': samples}
            (args.output / 'samples.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
            print(metrics)


if __name__ == '__main__':
    main()
