import assert from "node:assert/strict";
import test from "node:test";
import { affectedWindowsFolders } from "../mods/swifttree/windows-watch.js";

function folder(path, open, entries = []) {
  return { path, open, listing: { status: "ready", entries } };
}

test("targets opened parents for a move and all open folders for lost notifications", () => {
  const left = folder("C:\\Project\\Left", true);
  const right = folder("C:\\Project\\Right", true);
  const closed = folder("C:\\Project\\Closed", false);
  const root = folder("C:\\Project", false, [left, right, closed]);

  const result = affectedWindowsFolders(root, [
    "\\\\?\\C:\\PROJECT\\LEFT\\moved.txt",
    "\\\\?\\C:\\PROJECT\\RIGHT\\moved.txt",
    "C:\\Project\\Closed\\not-visible.txt",
  ]);
  assert.equal(result.reason, "change");
  assert.deepEqual(new Set(result.folders), new Set([left, right]));

  for (const signal of [[], ["\\\\?\\C:\\PROJECT"]]) {
    const recovery = affectedWindowsFolders(root, signal);
    assert.equal(recovery.reason, "recovery");
    assert.deepEqual(new Set(recovery.folders), new Set([root, left, right]));
  }
});

test("includes distinct NTFS folders with case-equivalent names in change and recovery reads", () => {
  const upper = folder("C:\\Project\\Notes", true);
  const lower = folder("C:\\Project\\notes", true);
  const root = folder("C:\\Project", false, [upper, lower]);

  const change = affectedWindowsFolders(root, ["c:\\PROJECT\\Notes\\created.txt"]);
  assert.equal(change.reason, "change");
  assert.deepEqual(new Set(change.folders), new Set([upper, lower]));

  const recovery = affectedWindowsFolders(root, []);
  assert.equal(recovery.reason, "recovery");
  assert.deepEqual(new Set(recovery.folders), new Set([root, upper, lower]));
});

test("rechecks expanded descendants when an open directory is replaced at the same path", () => {
  const child = folder("C:\\Project\\Branch\\Child", true);
  const closed = folder("C:\\Project\\Branch\\Closed", false);
  const branch = folder("C:\\Project\\Branch", true, [child, closed]);
  const unrelated = folder("C:\\Project\\Sibling", true);
  const root = folder("C:\\Project", false, [branch, unrelated]);

  const change = affectedWindowsFolders(root, ["C:\\Project\\Branch"]);
  assert.equal(change.reason, "change");
  assert.deepEqual(new Set(change.folders), new Set([root, branch, child]));
});
