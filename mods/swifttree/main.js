import { View, div } from "gpui-kit";
import { Button, Editor, EditorState, h_flex, Input, InputState, Scrollbar, v_flex, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { appHome, checking, exec, focused, layout, nextCommand, pickFolder, readTextFile, spaces, terminals, theme } from "herdr";
import { createDirectoryAccess } from "./directory-access.js";
import { readLinuxDirectory } from "./linux-directory.js";
import { readLinuxMachineState, readLinuxWatch, reconcileLinuxWatch } from "./linux-watch.js";
import { ancestorDirectoryIds, isOpenTreeFolder, makeEntry, openedTreeFolders, releaseEntry, retainEntry, setFolderListing, setFolderOpen } from "./tree-folders.js";
import { treeRows } from "./tree-rows.js";
import { readWindowsDirectory } from "./windows-directory.js";
import { affectedWindowsFolders } from "./windows-watch.js";
import { connectWindowsWatcher, readWindowsWatch } from "./windows-watch-connection.js";

const messages = {
  loading: "Loading folder…",
  waiting: "연결 후 불러올 수 있음",
  denied: "Access denied",
  missing: "Folder no longer exists",
  failed: "Could not read folder",
  empty: "Empty folder",
  cycle: "순환 링크",
};
const rowHeight = 28;

function activeSpace() {
  return spaces().find(space => space.active);
}

function hasVisibleAgent(node) {
  if (!node || node.hidden) return false;
  if (node.type === "block") return node.content?.agent != null;
  if (node.type === "stack") {
    const visible = node.children.filter(child => !child.hidden);
    return hasVisibleAgent(visible.find(child => child.id === node.active) ?? visible[0]);
  }
  return node.children?.some(hasVisibleAgent) ?? false;
}

function terminalLocation() {
  const focus = focused();
  if (!focus) return null;
  // With a visible Agent block, Herdr publishes that agent's cwd for the model pane.
  const agent = focus.pane !== null && hasVisibleAgent(layout()) ? focus.agent : null;
  const replacement = agent ? null : focus.shown;
  const address = agent ?? replacement ?? focus.terminal;
  if (!address) return null;
  let folder = focus.cwd;
  if (replacement) {
    // The focus snapshot's cwd belongs to the pane's own terminal.
    const shown = terminals().find(terminal => terminal.address === address);
    folder = shown?.foreground?.cwd || shown?.cwd;
  }
  if (!folder) return null;
  const separator = address.indexOf("/");
  return {
    folder,
    machine: separator < 0 ? null : address.slice(0, separator),
  };
}

function choiceKey(space) {
  return space ? JSON.stringify(["swifttree-root", space.machine ?? null, space.id]) : null;
}

function readDirectory(machine, folder, reason, access, ancestors) {
  return machine
    ? readLinuxDirectory(exec, appHome(), folder, machine, access, ancestors)
    : readWindowsDirectory(exec, appHome(), folder, reason, access, ancestors);
}

export default class SwiftTree extends View {
  init(_props, cx) {
    this.focus = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.scope = null;
    this.windowsWatches = new Map();
    this.rootKey = null;
    this.root = null;
    this.selected = null;
    this.scrollEntry = null;
    this.recoveryAnchors = null;
    this.preview = null;
    this.lastPreview = null;
    this.previewRequest = null;
    this.previewEditor = null;
    if (!checking()) {
      this.directoryAccess = createDirectoryAccess(cx);
      this.pathInput = InputState.new({ placeholder: "/path/to/folder" });
      this.pathInput.on("submit", (_event, cx) => this.submitRemotePath(this.scope, cx));
      cx.spawn(async () => {
        for (;;) {
          if (await nextCommand() === "focus") this.focus.focus();
        }
      });
    }
  }

  syncRoot(cx) {
    if (checking()) return;
    const space = activeSpace();
    const storageKey = choiceKey(space);
    if (storageKey !== (this.scope?.storageKey ?? null)) {
      this.scope = storageKey ? {
        storageKey,
        machine: space.machine ?? null,
        folder: localStorage.getItem(storageKey),
        initialListing: null,
        formOpen: false,
        busy: false,
        error: "",
      } : null;
    }

    const terminal = terminalLocation();
    const folder = terminal?.folder || space?.folder || this.scope?.folder;
    const machine = terminal ? terminal.machine : space?.machine ?? null;
    const key = folder ? JSON.stringify([storageKey, machine, folder]) : null;
    if (this.rootKey === key) return;

    this.stopWindowsWatches();
    this.rootKey = key;
    this.root = null;
    this.selected = null;
    this.scrollEntry = null;
    this.recoveryAnchors = null;
    this.preview = null;
    this.lastPreview = null;
    this.previewRequest = null;
    if (!folder) return;

    const pathSeparator = machine ? /\// : /[\\/]/;
    const name = folder.split(pathSeparator).filter(Boolean).at(-1) || folder;
    this.root = makeEntry(folder, name, true);
    this.root.machine = machine;
    if (machine) {
      this.root.remote = { offline: false, revision: 0, probe: null, folded: new Set() };
      this.startLinuxWatch(this.root, cx);
    } else {
      this.syncWindowsWatches(this.root, cx);
    }
    const initialListing = !terminal && folder === this.scope?.folder ? this.scope.initialListing : null;
    if (this.scope) this.scope.initialListing = null;
    if (initialListing) {
      setFolderListing(this.root, initialListing, machine ? "/" : "\\");
    }
    if (!initialListing || !machine) {
      this.loadFolder(this.root, cx, "open");
    }
  }

  loadFolder(folder, cx, reason = "open") {
    const root = this.root;
    const remote = root.remote;
    if (remote?.offline && reason === "open") {
      folder.listing ??= { status: "waiting" };
      return Promise.resolve(null);
    }
    const revision = remote?.revision;
    const request = {};
    const ancestors = ancestorDirectoryIds(folder);
    const watch = this.windowsWatches.get(folder);
    if (watch?.readRetry) {
      watch.readRetry.cancel();
      watch.readRetry = null;
    }
    folder.request = request;
    folder.listing ??= { status: "loading" };
    const current = () => this.root === root && folder.request === request && isOpenTreeFolder(folder, root);
    return new Promise(resolve => {
      cx.spawn(async cx => {
        const result = await readDirectory(root.machine, folder.path, reason, this.directoryAccess, ancestors);
        if (current() && remote && result.status === "failed") {
          await this.checkRemoteConnection(root, cx, reason === "recovery");
        }
        if (!current()) {
          resolve(null);
          return;
        }
        folder.request = null;
        if (revision !== remote?.revision) {
          resolve(false);
          return;
        }
        if (ancestorDirectoryIds(folder) !== ancestors) {
          this.loadFolder(folder, cx, reason).then(resolve);
          return;
        }
        if (root.machine && reason !== "open" && result.status === "failed") {
          resolve(false);
          return;
        }
        if (folder.link && !root.machine && reason !== "open" && this.retryWindowsLinkRead(root, folder, result, cx)) {
          resolve(false);
          return;
        }
        if (reason === "recovery" && remote) this.rememberRecoveryAnchor(root);
        const previous = folder.listing;
        setFolderListing(folder, result, root.machine ? "/" : "\\");
        if (!root.machine && this.windowsWatchScopeChanged(folder, previous)) this.syncWindowsWatches(root, cx);
        resolve(true);
        cx.notify();
      });
    });
  }

  stopWindowsWatches() {
    for (const [folder, watch] of this.windowsWatches) this.retireWindowsWatch(folder, watch);
  }

  retireWindowsWatch(folder, watch) {
    this.windowsWatches.delete(folder);
    this.closeWatchSocket(watch);
    watch.retry?.cancel();
    watch.readRetry?.cancel();
  }

  windowsWatchScopeChanged(folder, previous) {
    if (folder.link && !this.windowsWatches.has(folder)) return true;
    if (!previous?.expanded?.size) return false;
    return previous.identity !== folder.listing?.identity || previous.expanded.size !== folder.listing?.expanded?.size;
  }

  syncWindowsWatches(root, cx) {
    const targets = new Map([[root, null]]);
    for (const folder of openedTreeFolders(root)) {
      if (folder.link) targets.set(folder, ancestorDirectoryIds(folder));
    }
    for (const [folder, watch] of this.windowsWatches) {
      if (!targets.has(folder) || targets.get(folder) !== watch.ancestors) this.retireWindowsWatch(folder, watch);
    }
    for (const [folder, ancestors] of targets) {
      if (this.windowsWatches.has(folder)) continue;
      const watch = { folder, ancestors, unavailable: false, readUnavailable: false };
      this.windowsWatches.set(folder, watch);
      this.startWindowsWatch(root, watch, cx);
    }
    this.updateWindowsWatchUnavailable(root, cx);
  }

  updateWindowsWatchUnavailable(root, cx) {
    const unavailable = [...this.windowsWatches.values()].some(watch => watch.unavailable || watch.readUnavailable);
    this.setWatchUnavailable(root, unavailable, cx);
  }

  retryWindowsLinkRead(root, folder, result, cx) {
    const watch = this.windowsWatches.get(folder);
    if (!watch) return false;
    const retry = result.status === "failed" || result.status === "denied";
    if (retry) {
      watch.readRetry = cx.timer.after(250, cx => {
        watch.readRetry = null;
        if (this.root === root && this.windowsWatches.get(folder) === watch) this.loadFolder(folder, cx, "recovery");
      });
    }
    if (watch.readUnavailable !== retry) {
      watch.readUnavailable = retry;
      this.updateWindowsWatchUnavailable(root, cx);
    }
    return retry && folder.listing?.status === "ready";
  }

  closeWatchSocket(watch) {
    const socket = watch?.socket;
    if (!socket) return;
    watch.socket = null;
    socket.close();
  }

  reloadWindowsFolders(scope, paths, cx) {
    const { reason, folders } = affectedWindowsFolders(scope, paths);
    for (const folder of folders) this.loadFolder(folder, cx, reason);
  }

  startWindowsWatch(root, watch, cx) {
    const { folder } = watch;
    const current = () => this.windowsWatches.get(folder) === watch && this.root === root;
    watch.retry = null;
    cx.spawn(async cx => {
      try {
        watch.socket = await connectWindowsWatcher(folder.path, current, cx, watch.ancestors);
        if (!current() || !watch.socket) return;
        for (const opened of openedTreeFolders(folder)) {
          this.loadFolder(opened, cx, watch.unavailable ? "recovery" : "watch-start");
        }
        watch.unavailable = false;
        this.updateWindowsWatchUnavailable(root, cx);
        await readWindowsWatch(watch.socket, paths => {
          if (current()) this.reloadWindowsFolders(folder, paths, cx);
        });
      } catch {
        // A broken connection always takes the same recovery path.
      } finally {
        this.closeWatchSocket(watch);
      }
      if (!current()) return;
      watch.unavailable = true;
      this.updateWindowsWatchUnavailable(root, cx);
      watch.retry = cx.timer.after(1500, cx => {
        if (current()) this.startWindowsWatch(root, watch, cx);
      });
    });
  }

  startLinuxWatch(root, cx) {
    const current = () => this.root === root;
    const remote = root.remote;
    cx.spawn(async cx => {
      const previous = new Map();
      let revision = remote.revision;
      while (current()) {
        try {
          if (revision !== remote.revision) {
            previous.clear();
            revision = remote.revision;
          }
          const result = await readLinuxWatch(exec, root.machine, openedTreeFolders(root), previous, current);
          if (!current() || !result) return;
          if (revision !== remote.revision) continue;
          const { fingerprints, longPoll } = result;
          const failed = await reconcileLinuxWatch(fingerprints, previous, (folder, registered) => {
            if (!current() || revision !== remote.revision || !isOpenTreeFolder(folder, root)) return null;
            const reason = remote.offline || root.watchUnavailable ? "recovery" : registered ? "change" : "watch-start";
            return this.loadFolder(folder, cx, reason);
          });
          if (!current()) return;
          if (revision !== remote.revision) continue;
          const open = new Set(openedTreeFolders(root));
          for (const folder of previous.keys()) {
            if (!open.has(folder)) previous.delete(folder);
          }
          if (remote.offline && !failed && [...open].every(folder => previous.has(folder))) {
            this.finishRemoteRecovery(root, cx);
          }
          this.setWatchUnavailable(root, failed, cx);
          if (failed || !longPoll) await new Promise(resolve => cx.timer.after(failed ? 250 : 100, resolve));
        } catch {
          if (!current()) return;
          previous.clear();
          const state = await this.checkRemoteConnection(root, cx);
          if (!current()) return;
          this.setWatchUnavailable(root, true, cx);
          if (remote.offline && state === "connected") await this.recoverWithoutRemoteWatch(root, cx);
          await new Promise(resolve => cx.timer.after(1500, resolve));
        }
      }
    });
  }

  async checkRemoteConnection(root, cx, recovering = false) {
    const remote = root.remote;
    const revision = remote.revision;
    remote.probe ??= readLinuxMachineState(exec, root.machine).finally(() => { remote.probe = null; });
    const state = await remote.probe;
    if (state !== "offline" || this.root !== root || remote.revision !== revision) return state;
    if (remote.offline && !recovering) return state;
    remote.revision++;
    if (remote.offline) return state;
    remote.offline = true;
    for (const folder of openedTreeFolders(root)) {
      if (!folder.listing || folder.listing.status === "loading" || folder.listing.status === "failed") {
        folder.listing = { status: "waiting" };
      }
    }
    if (this.previewRequest) {
      this.preview = this.lastPreview ?? { name: this.previewRequest.name, status: messages.waiting };
      this.previewRequest = null;
    }
    cx.notify();
    return state;
  }

  async recoverWithoutRemoteWatch(root, cx) {
    const revision = root.remote.revision;
    const current = () => this.root === root && revision === root.remote.revision;
    const refreshed = new Set();
    for (const folder of openedTreeFolders(root)) {
      if (!current()) return;
      if (!isOpenTreeFolder(folder, root)) continue;
      const applied = await this.loadFolder(folder, cx, "recovery");
      if (applied === false) return;
      if (applied === true) refreshed.add(folder);
    }
    if (current() && openedTreeFolders(root).every(folder => refreshed.has(folder))) {
      this.finishRemoteRecovery(root, cx);
    }
  }

  finishRemoteRecovery(root, cx) {
    root.remote.offline = false;
    const folded = [...root.remote.folded];
    root.remote.folded.clear();
    for (const folder of folded) {
      folder.listing = null;
      this.releaseTreeEntry(folder);
    }
    cx.notify();
  }

  rememberRecoveryAnchor(root) {
    if (this.recoveryAnchors || this.scrollEntry) return;
    const rows = treeRows(root);
    const offset = this.scroll.offset().y;
    const height = this.scroll.viewport_size().height;
    if (!height) return;
    const first = Math.floor(offset / rowHeight);
    const last = Math.min(rows.length - 1, Math.ceil((offset + height) / rowHeight) - 1);
    const center = Math.min(last, Math.floor((offset + height / 2) / rowHeight));
    const selected = rows.indexOf(this.selected);
    const entries = new Map();
    if (selected >= first && selected <= last) entries.set(this.selected, selected);
    const indices = [];
    for (let index = first; index <= last; index++) indices.push(index);
    indices.sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
    for (const index of indices) {
      const entry = rows.rowAt(index)?.entry;
      if (entry) entries.set(retainEntry(entry), index);
    }
    this.recoveryAnchors = { entries, center };
  }

  setWatchUnavailable(root, unavailable, cx) {
    if (Boolean(root.watchUnavailable) === unavailable) return;
    root.watchUnavailable = unavailable;
    cx.notify();
  }

  canChoose(scope) {
    if (!scope || this.scope !== scope || scope.folder) return false;
    const space = activeSpace();
    return choiceKey(space) === scope.storageKey && !space.folder && !terminalLocation();
  }

  openFolder(scope, cx) {
    if (!this.canChoose(scope) || scope.busy) return;
    if (!scope.machine) {
      this.chooseFolder(scope, null, cx);
      return;
    }
    scope.formOpen = true;
    scope.error = "";
    this.pathInput.set_value("");
    this.pathInput.focus();
    cx.notify();
  }

  submitRemotePath(scope, cx) {
    if (!this.canChoose(scope) || !scope.formOpen || scope.busy) return;
    const path = this.pathInput.value();
    if (!path.startsWith("/")) {
      scope.error = "Enter an absolute Linux folder path.";
      cx.notify();
      return;
    }
    this.chooseFolder(scope, path, cx);
  }

  chooseFolder(scope, remotePath, cx) {
    scope.busy = true;
    scope.error = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        const folder = remotePath ?? await pickFolder({ prompt: "Open folder" });
        if (!folder || !this.canChoose(scope)) return;

        const listing = await readDirectory(scope.machine, folder, "validate", this.directoryAccess);
        if (!this.canChoose(scope)) return;
        if (listing.status !== "ready") {
          scope.error = messages[listing.status];
          return;
        }

        try {
          localStorage.setItem(scope.storageKey, folder);
          await localStorage.flush();
        } catch {
          if (localStorage.getItem(scope.storageKey) === folder) localStorage.removeItem(scope.storageKey);
          scope.error = "Could not save folder";
          return;
        }
        scope.folder = folder;
        scope.initialListing = listing;
      } catch {
        scope.error = "Could not open folder";
      } finally {
        scope.busy = false;
        if (this.scope === scope) cx.notify();
      }
    });
  }

  toggle(folder, cx) {
    const remote = this.root.remote;
    setFolderOpen(folder, !folder.open, remote?.offline);
    if (remote?.offline) {
      if (folder.open) remote.folded.delete(folder);
      else if (folder.listing) remote.folded.add(folder);
    }
    if (folder.open) this.loadFolder(folder, cx);
    else if (!this.root.machine) this.syncWindowsWatches(this.root, cx);
  }

  selectEntry(entry) {
    if (entry === this.selected) return;
    const previous = this.selected;
    this.selected = retainEntry(entry);
    this.releaseTreeEntry(previous);
    this.scrollEntry = null;
  }

  releaseTreeEntry(entry) {
    if (entry === this.selected || this.recoveryAnchors?.entries.has(entry) || this.root.remote?.folded.has(entry)) return;
    releaseEntry(entry);
  }

  openFile(entry, cx) {
    if (!this.preview) this.scrollEntry = entry;
    const root = this.root;
    if (root.remote?.offline) {
      this.preview ??= { name: entry.name, status: messages.waiting };
      return;
    }
    const request = { name: entry.name, status: "Loading preview…" };
    this.preview = request;
    this.previewRequest = request;
    this.previewEditor ??= EditorState.new({ readonly: true, line_numbers: false, folding: false, soft_wrap: true });
    cx.spawn(async cx => {
      const content = await readTextFile(entry.path, { on: root.machine }).catch(() => null);
      const current = () => this.root === root && this.previewRequest === request;
      if (current() && root.remote && content == null) await this.checkRemoteConnection(root, cx);
      if (!current()) return;
      this.previewRequest = null;
      if (content == null || content.includes("\0")) {
        request.status = "Preview unavailable";
      } else {
        this.lastPreview = request;
        if (content === "") {
          request.status = "Empty file";
        } else {
          this.previewEditor.set_value(content);
          this.previewEditor.set_selected_range({ start: 0, end: 0 });
          request.status = null;
        }
      }
      cx.notify();
    });
  }

  currentEntry(root, row) {
    const entry = row?.entry;
    if (entry && this.root === root && entry.parent.listing === row.listing && isOpenTreeFolder(entry.parent, root)) {
      return row.listing.retained.get(entry.index) ?? entry;
    }
  }

  handleKey(key, root, rows, cx) {
    const index = rows.indexOf(this.selected);
    const entry = this.currentEntry(root, rows.rowAt(index));
    if (key === "up" || key === "down" || key === "home" || key === "end") {
      const step = key === "down" || key === "home" ? 1 : -1;
      const edge = step > 0 ? 0 : rows.length - 1;
      const start = index < 0 || key === "home" || key === "end" ? edge : index + step;
      for (let next = start; next >= 0 && next < rows.length; next += step) {
        const selected = this.currentEntry(root, rows.rowAt(next));
        if (selected) {
          this.selectEntry(selected);
          this.scrollEntry = selected;
          break;
        }
      }
    } else if ((key === "right" || key === "enter") && entry?.directory && !entry.open) {
      this.toggle(entry, cx);
    } else if (key === "enter" && entry && !entry.directory) {
      this.openFile(entry, cx);
    } else if (key === "left" && entry?.directory && entry.open) {
      this.toggle(entry, cx);
    } else if (key === "left" && entry?.parent && entry.parent !== this.root) {
      this.selectEntry(entry.parent);
    } else {
      return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  renderRow(row, colors) {
    const entry = row.entry;
    const selected = entry != null && this.selected === entry;
    const glyph = entry?.directory ? (entry.open ? "▾" : "▸") : "";
    return h_flex()
      .h(rowHeight).w_full().pl(8 + row.depth * 18).pr(8).gap(6).items_center().rounded(5)
      .when(selected, element => element.bg(colors.selection))
      .when(entry != null, element => element.cursor_pointer().hover(style => style.bg(colors.hover)))
      .child(div().w(13).flex_none().text_color(colors.muted).child(glyph))
      .child(div().flex_1().min_w(0).truncate()
        .text_color(entry ? colors.foreground : colors.muted).child(entry?.name ?? messages[row.status]));
  }

  renderChooser(scope, colors) {
    const box = v_flex().p(14).gap(8);
    if (!scope) return box;
    const button = (id, label, action) => Button.new(id).h(30).px(10).rounded(6)
      .border_1().border_color(colors.border).text_color(colors.foreground)
      .disabled(scope.busy).hover(style => style.bg(colors.hover)).on_click(action).child(label);
    if (scope.formOpen) {
      box.child(div().text_color(colors.muted).truncate().child(`Folder path on ${scope.machine}`))
        .child(Input.new(this.pathInput).h(34).w_full().px(9).rounded(6)
          .border_1().border_color(colors.input).text_color(colors.foreground))
        .child(h_flex().gap(8)
          .child(button("choose-remote-folder", "Open", (_event, cx) => this.submitRemotePath(scope, cx)))
          .child(button("cancel-remote-folder", "Cancel", (_event, cx) => {
            if (scope.busy || this.scope !== scope) return;
            scope.formOpen = false;
            scope.error = "";
            this.focus.focus();
            cx.notify();
          })));
    } else {
      box.child(h_flex().child(button("open-folder", "Open folder", (_event, cx) => this.openFolder(scope, cx))));
    }
    if (scope.error || scope.busy) {
      box.child(div().text_color(colors.muted).child(scope.error || "Checking folder…"));
    }
    return box;
  }

  renderPreview(colors) {
    const preview = this.preview;
    const content = preview.status
      ? div().p(10).text_color(colors.muted).child(preview.status)
      : Editor.new(this.previewEditor).flex_1().min_h(0).w_full();
    return v_flex().flex_1().min_h(0).w_full().border_t(1).border_color(colors.border)
      .child(h_flex().h(32).flex_none().px(10).gap(8).items_center().border_b(1).border_color(colors.border)
        .child(div().flex_1().min_w(0).truncate().font_medium().text_color(colors.foreground).child(preview.name))
        .child(div().flex_none().text_color(colors.muted).child("Read-only")))
      .child(content);
  }

  render(cx) {
    this.syncRoot(cx);
    const colors = theme();
    const root = this.root;
    const rows = treeRows(root);
    // The native list consumes a position during layout. Resolve selection
    // against the same row projection that is passed to that layout.
    let scrollIndex = rows.indexOf(this.scrollEntry);
    this.scrollEntry = null;
    if (this.recoveryAnchors) {
      const { entries, center } = this.recoveryAnchors;
      this.recoveryAnchors = null;
      // Center the row at the same distance from the surviving viewport anchor.
      if (scrollIndex < 0) {
        for (const [entry, index] of entries) {
          const updated = rows.indexOf(entry);
          if (updated < 0) continue;
          if (updated !== index) scrollIndex = Math.max(0, Math.min(rows.length - 1, updated + center - index));
          break;
        }
      }
      for (const entry of entries.keys()) this.releaseTreeEntry(entry);
    }
    if (scrollIndex >= 0) this.scroll.scroll_to_item(scrollIndex, "center");
    const visibleRows = new Map();

    const list = v_virtual_list("swifttree-rows", rows.length, rowHeight,
      index => rows.rowAt(index).key,
      range => {
        visibleRows.clear();
        const elements = [];
        for (let index = range.start; index < range.end; index++) {
          const row = rows.rowAt(index);
          visibleRows.set(row.key, row);
          elements.push(this.renderRow(row, colors));
        }
        return elements;
      })
      .flex_1().min_h(0).w_full().track_scroll(this.scroll)
      .on_item_click((key, cx) => {
        const row = visibleRows.get(key);
        const entry = this.currentEntry(root, row);
        if (!entry) return;
        this.focus.focus();
        this.selectEntry(entry);
        if (entry.directory) this.toggle(entry, cx);
        else this.openFile(entry, cx);
        cx.notify();
      });

    return v_flex().id("swifttree").size_full().min_h(0).rounded(10)
      .overflow_hidden().bg(colors.background).border_1().border_color(colors.border).text_size(13)
      .track_focus(this.focus).on_key_down((event, cx) => {
        if (root && this.root === root) this.handleKey(event.keystroke, root, treeRows(root), cx);
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(colors.border)
        .child(div().font_semibold().text_color(colors.foreground).child("SwiftTree"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_color(colors.muted).child(this.root?.name ?? "")))
      .when(root?.remote?.offline || root?.watchUnavailable, panel => panel.child(div().px(14).py(5)
        .text_color(colors.muted).child(root.remote?.offline ? "연결 끊김 · 마지막으로 확인한 내용" : "Live updates unavailable")))
      .child(root ? v_flex().relative().flex_1().min_h(0).p(6)
        .child(list)
        .child(Scrollbar.vertical("swifttree-rows").absolute().inset_0()) : this.renderChooser(this.scope, colors))
      .when(this.preview != null, panel => panel.child(this.renderPreview(colors)));
  }
}
