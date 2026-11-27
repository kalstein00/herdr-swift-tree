import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { readLinuxDirectory } from "../mods/swifttree/linux-directory.js";
import { buildWindowsReader } from "./native-windows-reader.mjs";

const run = promisify(execFile);
const folder = "/home/bench/Notes’ List\\fixtures";
const machine = "registered-linux";

test("routes the literal Linux path and preserves ordered names and types", async context => {
  const temp = await realpath(tmpdir());
  const appHome = await mkdtemp(join(temp, "swift-tree-linux-test-"));
  assert.equal(dirname(await realpath(appHome)), temp);
  context.after(() => rm(appHome, { recursive: true, force: true }));
  await buildWindowsReader(appHome);

  const encoded = Buffer.from("ffile10\0dFolder02\0f파일\nname\0dFolder2\0ffile2\0\0").toString("base64");
  const collator = new Intl.Collator(undefined, { numeric: true });
  const expected = ["file10", "Folder02", "파일\nname", "Folder2", "file2"]
    .map(name => ({ name, directory: name.startsWith("Folder") }))
    .sort((left, right) => Number(right.directory) - Number(left.directory)
      || collator.compare(left.name, right.name) || left.name.length - right.name.length);

  function reader(response) {
    return async (program, args) => {
      if (program !== "hc") return { code: 0, ...await run(program, args) };
      assert.deepEqual(args.slice(0, 7), ["exec", "--json", "--on", machine, "--", "sh", "-c"]);
      assert.equal(args.at(-1), folder);
      return { code: 0, stdout: JSON.stringify(response) };
    };
  }

  assert.deepEqual(await readLinuxDirectory(reader({ code: 0, stdout: encoded }), appHome, folder, machine),
    { status: "ready", entries: expected });
  for (const [exit, status] of [[43, "denied"], [44, "missing"]]) {
    assert.deepEqual(await readLinuxDirectory(reader({ code: exit }), appHome, folder, machine), { status });
  }
  for (const bytes of [Buffer.from("ftruncated\0"), Buffer.from([0x66, 0xff, 0, 0])]) {
    const response = { code: 0, stdout: bytes.toString("base64") };
    assert.deepEqual(await readLinuxDirectory(reader(response), appHome, folder, machine), { status: "failed" });
  }
  assert.deepEqual(await readdir(appHome), ["mods"]);
});
