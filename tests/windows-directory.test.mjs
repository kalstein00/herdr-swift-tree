import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { readWindowsDirectory } from "../mods/swifttree/windows-directory.js";
import { buildWindowsReader } from "./native-windows-reader.mjs";

const run = promisify(execFile);
async function exec(file, args) {
  return { code: 0, ...await run(file, args) };
}

test("reads literal NTFS paths and follows the default numeric Explorer collation", async context => {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(join(temp, "swift-tree-test-"));
  assert.equal(dirname(await realpath(root)), temp);
  context.after(() => rm(root, { recursive: true, force: true }));
  await buildWindowsReader(root);
  const folder = join(root, "O'Brien’s [fixtures] & files");
  await mkdir(folder);

  const folders = ["Zeta", "Folder02", "Folder10", "Folder2"];
  const files = ["alpha.txt", "item02.txt", "item2.txt", "item10.txt", "éclair.txt", "파일2.txt"];
  await Promise.all(folders.map(name => mkdir(join(folder, name))));
  await Promise.all(files.map(name => writeFile(join(folder, name), "")));

  const collator = new Intl.Collator(undefined, { numeric: true });
  const compare = (left, right) => collator.compare(left, right) || left.length - right.length;
  const expected = [
    ...folders.sort(compare).map(name => ({ name, directory: true })),
    ...files.sort(compare).map(name => ({ name, directory: false })),
  ];
  assert.deepEqual(await readWindowsDirectory(exec, root, folder), { status: "ready", entries: expected });
  assert.deepEqual(await readWindowsDirectory(exec, root, join(folder, "Zeta")), { status: "ready", entries: [] });
  assert.deepEqual(await readWindowsDirectory(exec, root, join(folder, "missing")), { status: "missing" });
});
