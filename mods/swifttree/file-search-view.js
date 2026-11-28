import { div } from "gpui-kit";
import { h_flex, Input, InputState, v_flex } from "gpui-base";
import { appHome, closeOverlay, exec, layout, run, setShared, theme } from "herdr";
import { createDirectoryAccess } from "./directory-access.js";
import { collectFiles, linuxGitSearchScope, matchingFiles, windowsGitSearchScope } from "./file-search.js";
import { readLinuxDirectory } from "./linux-directory.js";
import { readWindowsDirectory, windowsHelperPath } from "./windows-directory.js";

export const searchSelectionKey = "swifttree-file-search-selection";
const visibleRows = 9;

function filesPath(node) {
  if (node?.id === "files" && node.content?.mod === "swifttree") return [node];
  for (const child of node?.children ?? []) {
    const path = filesPath(child);
    if (path) return [node, ...path];
  }
  return null;
}

export class FileSearchView {
  constructor(id, resolveRoot, cx) {
    this.id = id;
    this.resolveRoot = resolveRoot;
    this.input = InputState.new({ placeholder: "파일 이름 입력…" });
    this.focus = cx.focus_handle();
    this.files = [];
    this.rows = [];
    this.cursor = 0;
    this.top = 0;
    this.input.on("change", (_event, cx) => {
      this.cursor = 0;
      this.top = 0;
      this.selectedPath = null;
      this.refresh();
      cx.notify();
    });
    this.input.on("submit", () => this.open(this.rows[this.cursor]?.file));
    this.input.focus();
  }

  refresh() {
    this.rows = matchingFiles(this.files, this.input.value());
    if (this.selectedPath) {
      const selected = this.rows.findIndex(({ file }) => file.path === this.selectedPath);
      if (selected >= 0) this.cursor = selected;
    }
    this.cursor = Math.min(this.cursor, Math.max(0, this.rows.length - 1));
    this.top = Math.max(this.cursor - visibleRows + 1, Math.min(this.top, this.cursor));
  }

  close() {
    this.closed = true;
    this.root = null;
    this.access?.close();
  }

  sync(cx) {
    if (this.closed) return;
    const root = this.resolveRoot();
    if (this.root?.key === root?.key) return;
    this.access?.close();
    this.root = root;
    this.files = [];
    this.selectedPath = null;
    this.failed = false;
    this.refresh();
    this.loading = Boolean(root);
    if (!this.loading) return;
    const current = () => this.root === root && this.resolveRoot()?.key === root.key;
    cx.spawn(async cx => {
      let access;
      try {
        if (!current()) return;
        access = createDirectoryAccess(cx);
        this.access = access;
        const readDirectory = root.machine
          ? (path, descendant) => readLinuxDirectory(exec, appHome(), path, root.machine, access, "", descendant ? root.folder : "")
          : (path, descendant) => readWindowsDirectory(exec, appHome(), path,
              descendant ? "search-child" : "search", access, descendant ? root.folder : "");
        const readGitScope = root.machine
          ? folder => linuxGitSearchScope(exec, folder, root.machine, current)
          : folder => windowsGitSearchScope(exec, windowsHelperPath(appHome()), appHome(), folder, current);
        await collectFiles(root.folder, root.machine ? "/" : "\\", readDirectory, current,
          files => {
            this.files = files;
            this.refresh();
            cx.notify();
          }, readGitScope);
      } catch {
        if (current()) this.failed = true;
      } finally {
        access?.close();
        if (this.access === access) this.access = null;
        if (current()) {
          this.loading = false;
          cx.notify();
        }
      }
    });
  }

  open(file, root = this.root) {
    if (!file || !root || this.opening || root !== this.root || this.resolveRoot()?.key !== root.key) return;
    const path = filesPath(layout());
    if (!path) return;
    this.opening = true;
    const selection = { root: root.key, ...file };
    for (const [index, node] of path.entries()) {
      if (node.hidden) run("layout.show", { id: node.id });
      if (node.type === "stack" && node.active !== path[index + 1].id) {
        run("layout.select", { stack: node.id, child: path[index + 1].id });
      }
    }
    if (this.resolveRoot()?.key === selection.root) setShared(searchSelectionKey, selection);
    this.close();
    closeOverlay(this.id);
  }

  render(cx) {
    this.sync(cx);
    const colors = theme();
    const panel = v_flex().id("swifttree-file-search").track_focus(this.focus)
      .w_full().rounded(9).border_1().border_color(colors.border).bg(colors.popover).p(10).gap(5)
      .on_key_down((event, cx) => {
        if (event.key === "escape") {
          cx.stop_propagation();
          this.close();
          closeOverlay(this.id);
        } else if (event.key === "up" || event.key === "down") {
          cx.stop_propagation();
          if (!this.rows.length) return;
          const next = this.cursor + (event.key === "up" ? -1 : 1);
          this.cursor = Math.max(0, Math.min(this.rows.length - 1, next));
          this.selectedPath = this.rows[this.cursor].file.path;
          this.top = Math.max(this.cursor - visibleRows + 1, Math.min(this.top, this.cursor));
          cx.notify();
        }
      })
      .child(Input.new(this.input).w_full().h(36).px(9).border_1().border_color(colors.input)
        .rounded(5).text_color(colors.foreground));
    if (!this.input.value().trim()) return panel;
    if (!this.rows.length) {
      const message = this.loading ? "파일 검색 중…" :
        this.failed ? "파일 목록을 읽을 수 없습니다" : "일치하는 파일이 없습니다";
      return panel.child(div().px(9).py(5).text_color(colors.muted).child(message));
    }
    const root = this.root;
    panel.children(this.rows.slice(this.top, this.top + visibleRows).map(({ file, hits }, index) =>
      h_flex().id("search-row-" + (this.top + index)).w_full().h(29).px(9).items_center().gap(9)
        .rounded(5).cursor_pointer().hover(row => row.bg(colors.hover))
        .when(this.top + index === this.cursor, row => row.bg(colors.selected))
        .on_click(() => this.open(file, root))
        .child(h_flex().max_w(330).overflow_hidden().flex_none().text_color(colors.foreground)
          .children([...file.name].map((letter, index) => div()
            .when(hits.includes(index), text => text.font_semibold().text_color(colors.accent))
            .child(letter === " " ? "\u00a0" : letter))))
        .child(div().min_w(0).truncate().text_color(colors.muted).child(file.folder || "."))));
    const selected = this.rows[this.cursor].file;
    if (selected.name.length > 38 || selected.folder.length > 45) {
      const fullName = selected.folder ? selected.folder + "/" + selected.name : selected.name;
      panel.child(div().px(9).text_color(colors.muted).child(fullName));
    }
    return panel;
  }
}
