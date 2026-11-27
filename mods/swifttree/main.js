import { View, div } from "gpui-kit";
import { h_flex, Scrollbar, v_flex, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { appHome, checking, exec, nextCommand, spaces, theme } from "herdr";
import { readLinuxDirectory } from "./linux-directory.js";
import { readWindowsDirectory } from "./windows-directory.js";

const messages = {
  loading: "Loading folder…",
  denied: "Access denied",
  missing: "Folder no longer exists",
  failed: "Could not read folder",
  empty: "Empty folder",
};

function makeEntry(path, name, directory, parent = null) {
  return { path, name, directory, parent, open: false, listing: null };
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
    this.rootKey = null;
    this.root = null;
    this.selected = null;
    if (!checking()) {
      cx.spawn(async () => {
        for (;;) {
          if (await nextCommand() === "focus") this.focus.focus();
        }
      });
    }
  }

  syncRoot(cx) {
    if (checking()) return;
    const space = spaces().find(candidate => candidate.active);
    const folder = space?.folder;
    const machine = space?.machine ?? null;
    const key = folder ? JSON.stringify([machine, space.id, folder]) : null;
    if (this.rootKey === key) return;

    this.rootKey = key;
    this.root = null;
    this.selected = null;
    if (!folder) return;

    const pathSeparator = machine ? /\// : /[\\/]/;
    const name = folder.split(pathSeparator).filter(Boolean).at(-1) || folder;
    this.root = makeEntry(folder, name, true);
    this.root.machine = machine;
    this.loadFolder(this.root, cx);
  }

  loadFolder(folder, cx) {
    const root = this.root;
    const request = { status: "loading" };
    folder.listing = request;
    cx.spawn(async cx => {
      const result = root.machine
        ? await readLinuxDirectory(exec, appHome(), folder.path, root.machine)
        : await readWindowsDirectory(exec, folder.path);
      if (this.root !== root || folder.listing !== request) return;

      const prefix = root.machine ? folder.path.replace(/\/+$/, "") : folder.path.replace(/[\\/]+$/, "");
      const separator = root.machine ? "/" : "\\";
      folder.listing = result.status === "ready" ? {
        status: "ready",
        entries: result.entries.map(({ name, directory }) =>
          makeEntry(`${prefix}${separator}${name}`, name, directory, folder)),
      } : result;
      cx.notify();
    });
  }

  toggle(folder, cx) {
    folder.open = !folder.open;
    if (folder.open) this.loadFolder(folder, cx);
    else folder.listing = null;
  }

  handleKey(key, rows, cx) {
    const index = rows.findIndex(row => row.entry === this.selected);
    const entry = this.selected;
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

  render(cx) {
    this.syncRoot(cx);
    const colors = theme();
    const root = this.root;
    const rows = [];
    if (root) appendRows(rows, root, 0);
    else rows.push({ key: "no-root", depth: 0, label: "No folder" });
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
        cx.notify();
      });

    return v_flex().id("swifttree").size_full().min_h(0).rounded(10)
      .overflow_hidden().bg(colors.background).border_1().border_color(colors.border).text_size(13)
      .track_focus(this.focus).on_key_down((event, cx) => this.handleKey(event.keystroke, rows, cx))
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(colors.border)
        .child(div().font_semibold().text_color(colors.foreground).child("SwiftTree"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_color(colors.muted).child(this.root?.name ?? "")))
      .child(v_flex().relative().flex_1().min_h(0).p(6)
        .child(list)
        .child(Scrollbar.vertical("swifttree-rows").absolute().inset_0()));
  }
}
