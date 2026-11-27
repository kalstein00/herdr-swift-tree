import assert from "node:assert/strict";
import test from "node:test";
import { ancestorDirectoryIds, isOpenTreeFolder, makeEntry, openedTreeFolders, releaseEntry, retainEntry, setFolderListing, setFolderOpen } from "../mods/swifttree/tree-folders.js";
import { treeRows } from "../mods/swifttree/tree-rows.js";

const directory = name => ({ name, directory: true });
const file = name => ({ name, directory: false });
const list = (folder, entries) => setFolderListing(folder, { status: "ready", entries }, "/");

test("every sorted row in a wide listing remains addressable without materializing the other rows", () => {
  let reads = 0;
  const names = Array.from({ length: 100_000 }, (_, index) => `row-${index + 1}`);
  const entries = names.map(name => ({
    directory: false,
    get name() {
      reads++;
      return name;
    },
  }));
  const root = makeEntry("/workspace", "workspace", true);
  list(root, entries);
  const rows = treeRows(root);
  assert.equal(rows.length, names.length);
  assert.deepEqual(openedTreeFolders(root), [root]);
  assert.equal(reads, 0);
  const last = retainEntry(rows.rowAt(99_999).entry);
  assert.equal(rows.indexOf(last), 99_999);
  assert.equal(rows.rowAt(0).entry.name, "row-1");
  assert.equal(reads, 2);
  assert.deepEqual(Array.from({ length: rows.length }, (_, index) => rows.rowAt(index).entry.name), names);
  assert.equal(root.listing.retained.size, 1);
});

test("expanded and selected rows keep their identity through reordering and retire after replacement", () => {
  const root = makeEntry("/workspace", "workspace", true);
  list(root, [directory("dir"), directory("unused"), file("first"), file("last")]);
  const initial = treeRows(root);
  const branch = initial.rowAt(0).entry;
  const unused = initial.rowAt(1).entry;
  const last = retainEntry(initial.rowAt(3).entry);
  setFolderOpen(branch, true);
  list(branch, [directory("blank"), file("nested")]);
  const blank = treeRows(root).rowAt(1).entry;
  setFolderOpen(blank, true);
  list(blank, []);

  const open = treeRows(root);
  assert.deepEqual(Array.from({ length: open.length }, (_, index) => {
    const row = open.rowAt(index);
    return [row.entry?.name ?? row.status, row.depth];
  }), [["dir", 0], ["blank", 1], ["empty", 2], ["nested", 1], ["unused", 0], ["first", 0], ["last", 0]]);
  assert.equal(open.indexOf(last), 6);
  assert.deepEqual(openedTreeFolders(root), [root, branch, blank]);
  assert.equal(isOpenTreeFolder(unused, root), false);

  list(root, [directory("before"), directory("dir"), file("last")]);
  const refreshed = treeRows(root);
  assert.equal(refreshed.rowAt(1).entry, branch);
  assert.equal(refreshed.rowAt(2).entry, blank);
  assert.equal(refreshed.rowAt(5).entry, last);
  assert.equal(refreshed.indexOf(last), 5);

  list(root, [file("dir")]);
  const replaced = treeRows(root);
  assert.notEqual(replaced.rowAt(0).entry, branch);
  assert.equal(replaced.indexOf(branch), -1);
  assert.equal(replaced.indexOf(last), -1);
  assert.equal(isOpenTreeFolder(blank, root), false);
  assert.deepEqual(openedTreeFolders(root), [root]);
});

test("moving selection keeps only the current row and expanded folders alive", () => {
  const root = makeEntry("/workspace", "workspace", true);
  list(root, [directory("folder"), ...Array.from({ length: 10_000 }, (_, index) => file(`row-${index}`))]);
  const initial = treeRows(root);
  let selection = initial.rowAt(0).entry;
  setFolderOpen(selection, true);
  const rows = treeRows(root);
  for (let index = 1; index < rows.length; index++) {
    releaseEntry(selection);
    selection = retainEntry(rows.rowAt(index).entry);
  }
  assert.equal(root.listing.retained.size, 2);
  assert.equal(rows.indexOf(selection), rows.length - 1);
  list(root, [file("replacement")]);
  releaseEntry(selection);
  assert.equal(treeRows(root).rowAt(0).entry.name, "replacement");
});

test("only the current branch contributes ancestors, and retargeting a link retires its previous children", () => {
  const listTarget = (folder, identity, entries) => setFolderListing(folder, { status: "ready", identity, entries }, "/");
  const root = makeEntry("/workspace", "workspace", true);
  const link = name => ({ name, directory: true, link: true });
  listTarget(root, "1:10", [link("first"), link("second")]);
  const links = treeRows(root);
  const first = links.rowAt(0).entry;
  const second = links.rowAt(1).entry;
  setFolderOpen(first, true);
  listTarget(first, "2:11", [directory("nested")]);
  assert.equal(ancestorDirectoryIds(second), "1:10");
  setFolderOpen(second, true);
  listTarget(second, "2:11", []);
  listTarget(root, "1:10", [{ name: "first", directory: false, link: true, targetUnknown: true }, link("second")]);
  assert.equal(treeRows(root).rowAt(0).entry, first);
  assert.equal(isOpenTreeFolder(first, root), true);
  const nested = treeRows(root).rowAt(1).entry;
  setFolderOpen(nested, true);
  listTarget(nested, "2:12", []);
  assert.equal(ancestorDirectoryIds(nested), "2:11,1:10");
  listTarget(first, "2:21", [directory("nested")]);
  assert.equal(isOpenTreeFolder(nested, root), false);
  assert.deepEqual(new Set(openedTreeFolders(root)), new Set([root, first, second]));
});
