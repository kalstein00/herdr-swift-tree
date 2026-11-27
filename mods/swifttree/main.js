import { View, div } from "gpui-kit";
import { Button, Editor, EditorState, h_flex, Input, InputState, Scrollbar, v_flex, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { appHome, checking, exec, nextCommand, pickFolder, readTextFile, spaces, theme } from "herdr";
import { readLinuxDirectory } from "./linux-directory.js";
import { readWindowsDirectory } from "./windows-directory.js";
import { affectedWindowsFolders } from "./windows-watch.js";
import { connectWindowsWatcher, readWindowsWatch } from "./windows-watch-connection.js";

const messages = {
  loading: "Loading folder…",
  denied: "Access denied",
  missing: "Folder no longer exists",
  failed: "Could not read folder",
  empty: "Empty folder",
};

function makeEntry(path, name, directory, parent = null) {
  return { path, name, directory, parent, open: false, listing: null, request: null };
}

function activeSpace() {
  return spaces().find(space => space.active);
}

function choiceKey(space) {
  return space ? JSON.stringify(["swifttree-root", space.machine ?? null, space.id]) : null;
}

function readDirectory(machine, folder, reason) {
  return machine
    ? readLinuxDirectory(exec, appHome(), folder, machine)
    : readWindowsDirectory(exec, appHome(), folder, reason);
}

function appendRows(rows, folder, depth) {
  const listing = folder.listing;
  if (!listing) return;
  if (listing.status !== "ready" || !listing.entries.length) {
    const label = messages[listing.status === "ready" ? "empty" : listing.status];
    rows.push({ key: `status:${folder.path}`, depth, label });
    return;
  }
  for (const entry of listing.entries) {
    rows.push({ key: `entry:${entry.path}`, depth, entry });
    if (entry.open) appendRows(rows, entry, depth + 1);
  }
}

export default class SwiftTree extends View {
  init(_props, cx) {
    this.focus = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.scope = null;
    this.watching = null;
    this.rootKey = null;
    this.root = null;
    this.selected = null;
    this.preview = null;
    this.previewEditor = null;
    if (!checking()) {
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
    const machine = space?.machine ?? null;
    const storageKey = choiceKey(space);
    if (storageKey !== (this.scope?.storageKey ?? null)) {
      this.scope = storageKey ? {
        storageKey,
        machine,
        folder: localStorage.getItem(storageKey),
        initialListing: null,
        formOpen: false,
        busy: false,
        error: "",
      } : null;
    }

    const folder = space?.folder || this.scope?.folder;
    const key = folder ? JSON.stringify([storageKey, folder]) : null;
    if (this.rootKey === key) return;

    this.stopWindowsWatch();
    this.rootKey = key;
    this.root = null;
    this.selected = null;
    this.preview = null;
    if (!folder) return;

    const pathSeparator = machine ? /\// : /[\\/]/;
    const name = folder.split(pathSeparator).filter(Boolean).at(-1) || folder;
    this.root = makeEntry(folder, name, true);
    this.root.machine = machine;
    if (!machine) this.startWindowsWatch(this.root, cx);
    const initialListing = this.scope.initialListing;
    this.scope.initialListing = null;
    if (initialListing && folder === this.scope.folder) {
      this.applyListing(this.root, initialListing, machine);
    }
    if (!initialListing || folder !== this.scope.folder || !machine) {
      this.loadFolder(this.root, cx, "open");
    }
  }

  applyListing(folder, result, machine) {
    if (result.status !== "ready") {
      folder.listing = result;
      return;
    }

    const prefix = machine ? folder.path.replace(/\/+$/, "") : folder.path.replace(/[\\/]+$/, "");
    const separator = machine ? "/" : "\\";
    const previous = new Map(folder.listing?.entries?.map(entry => [entry.name, entry]));
    folder.listing = {
      status: "ready",
      entries: result.entries.map(({ name, directory }) => {
        const entry = previous.get(name);
        return entry?.directory === directory ? entry : makeEntry(`${prefix}${separator}${name}`, name, directory, folder);
      }),
    };
  }

  loadFolder(folder, cx, reason = "open") {
    const root = this.root;
    const request = {};
    folder.request = request;
    folder.listing ??= { status: "loading" };
    cx.spawn(async cx => {
      const result = await readDirectory(root.machine, folder.path, reason);
      if (this.root !== root || folder.request !== request) return;
      folder.request = null;
      this.applyListing(folder, result, root.machine);
      cx.notify();
    });
  }

  stopWindowsWatch() {
    const watch = this.watching;
    this.watching = null;
    this.closeWatchSocket(watch);
    watch?.retry?.cancel();
  }

  closeWatchSocket(watch) {
    const socket = watch?.socket;
    if (!socket) return;
    watch.socket = null;
    socket.close();
  }

  reloadWindowsFolders(root, paths, cx) {
    const { reason, folders } = affectedWindowsFolders(root, paths);
    for (const folder of folders) this.loadFolder(folder, cx, reason);
  }

  startWindowsWatch(root, cx, recovering = false) {
    const watch = {};
    this.watching = watch;
    const current = () => this.watching === watch && this.root === root;
    cx.spawn(async cx => {
      try {
        watch.socket = await connectWindowsWatcher(root.path, current, cx);
        if (!current() || !watch.socket) return;
        const { folders } = affectedWindowsFolders(root, []);
        for (const folder of folders) this.loadFolder(folder, cx, recovering ? "recovery" : "watch-start");
        if (root.watchUnavailable) {
          root.watchUnavailable = false;
          cx.notify();
        }
        await readWindowsWatch(watch.socket, paths => {
          if (current()) this.reloadWindowsFolders(root, paths, cx);
        });
      } catch {
        // A broken connection always takes the same recovery path.
      } finally {
        this.closeWatchSocket(watch);
      }
      if (!current()) return;
      root.watchUnavailable = true;
      cx.notify();
      watch.retry = cx.timer.after(1500, cx => {
        if (current()) this.startWindowsWatch(root, cx, true);
      });
    });
  }

  canChoose(scope) {
    if (!scope || this.scope !== scope || scope.folder) return false;
    const space = activeSpace();
    return choiceKey(space) === scope.storageKey && !space.folder;
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

        const listing = await readDirectory(scope.machine, folder, "validate");
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
    folder.open = !folder.open;
    if (folder.open) this.loadFolder(folder, cx);
    else {
      folder.request = null;
      folder.listing = null;
    }
  }

  openFile(entry, rows, cx) {
    if (!this.preview) {
      const index = rows.findIndex(row => row.entry === entry);
      if (index >= 0) this.scroll.scroll_to_item(index, "center");
    }
    const root = this.root;
    const request = { name: entry.name, status: "Loading preview…" };
    this.preview = request;
    this.previewEditor ??= EditorState.new({ readonly: true, line_numbers: false, folding: false, soft_wrap: true });
    cx.spawn(async cx => {
      const content = await readTextFile(entry.path, { on: root.machine }).catch(() => null);
      if (this.root !== root || this.preview !== request) return;
      if (content == null || content.includes("\0")) {
        request.status = "Preview unavailable";
      } else if (content === "") {
        request.status = "Empty file";
      } else {
        this.previewEditor.set_value(content);
        this.previewEditor.set_selected_range({ start: 0, end: 0 });
        request.status = null;
      }
      cx.notify();
    });
  }

  handleKey(key, rows, cx) {
    const index = rows.findIndex(row => row.entry === this.selected);
    const entry = rows[index]?.entry;
    if (key === "up" || key === "down") {
      const step = key === "down" ? 1 : -1;
      const start = index < 0 ? (step > 0 ? 0 : rows.length - 1) : index + step;
      for (let next = start; next >= 0 && next < rows.length; next += step) {
        if (rows[next].entry) {
          this.selected = rows[next].entry;
          this.scroll.scroll_to_item(next, "center");
          break;
        }
      }
    } else if ((key === "right" || key === "enter") && entry?.directory && !entry.open) {
      this.toggle(entry, cx);
    } else if (key === "enter" && entry && !entry.directory) {
      this.openFile(entry, rows, cx);
    } else if (key === "left" && entry?.directory && entry.open) {
      this.toggle(entry, cx);
    } else if (key === "left" && entry?.parent && entry.parent !== this.root) {
      this.selected = entry.parent;
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
      .h(28).w_full().pl(8 + row.depth * 18).pr(8).gap(6).items_center().rounded(5)
      .when(selected, element => element.bg(colors.selection))
      .when(entry != null, element => element.cursor_pointer().hover(style => style.bg(colors.hover)))
      .child(div().w(13).flex_none().text_color(colors.muted).child(glyph))
      .child(div().flex_1().min_w(0).truncate()
        .text_color(entry ? colors.foreground : colors.muted).child(entry?.name ?? row.label));
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
    const rows = [];
    if (root) appendRows(rows, root, 0);
    const entriesByKey = new Map(rows.filter(row => row.entry).map(row => [row.key, row.entry]));

    const list = v_virtual_list("swifttree-rows", rows.length, 28,
      index => rows[index].key,
      range => rows.slice(range.start, range.end).map(row => this.renderRow(row, colors)))
      .flex_1().min_h(0).w_full().track_scroll(this.scroll)
      .on_item_click((key, cx) => {
        if (this.root !== root) return;
        const entry = entriesByKey.get(key);
        if (!entry) return;
        this.focus.focus();
        this.selected = entry;
        if (entry.directory) this.toggle(entry, cx);
        else this.openFile(entry, rows, cx);
        cx.notify();
      });

    return v_flex().id("swifttree").size_full().min_h(0).rounded(10)
      .overflow_hidden().bg(colors.background).border_1().border_color(colors.border).text_size(13)
      .track_focus(this.focus).on_key_down((event, cx) => {
        if (root) this.handleKey(event.keystroke, rows, cx);
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(colors.border)
        .child(div().font_semibold().text_color(colors.foreground).child("SwiftTree"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_color(colors.muted).child(this.root?.name ?? "")))
      .when(root?.watchUnavailable, panel => panel.child(div().px(14).py(5).text_color(colors.muted).child("Live updates unavailable")))
      .child(root ? v_flex().relative().flex_1().min_h(0).p(6)
        .child(list)
        .child(Scrollbar.vertical("swifttree-rows").absolute().inset_0()) : this.renderChooser(this.scope, colors))
      .when(this.preview != null, panel => panel.child(this.renderPreview(colors)));
  }
}
