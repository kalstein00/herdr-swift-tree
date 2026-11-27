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

  const encoded = Buffer.from("12:42\0f-file10\0d-Folder02\0f-파일\nname\0ldFolder2\0lNBroken\0f-file2\0\0").toString("base64");
  const collator = new Intl.Collator(undefined, { numeric: true });
  const expected = [
    { name: "file10", directory: false },
    { name: "Folder02", directory: true },
    { name: "파일\nname", directory: false },
    { name: "Folder2", directory: true, link: true },
    { name: "Broken", directory: false, link: true, targetUnknown: true },
    { name: "file2", directory: false },
  ]
    .sort((left, right) => Number(right.directory) - Number(left.directory)
      || collator.compare(left.name, right.name) || left.name.length - right.name.length);

  function reader(response) {
    return async (program, args) => {
      if (program !== "hc") return { code: 0, ...await run(program, args) };
      assert.deepEqual(args.slice(0, 7), ["exec", "--json", "--on", machine, "--", "sh", "-c"]);
      assert.equal(args.at(-2), folder);
      assert.equal(args.at(-1), "12:11");
      return { code: 0, stdout: JSON.stringify(response) };
    };
  }

  const read = response => readLinuxDirectory(reader(response), appHome, folder, machine, undefined, "12:11");
  assert.deepEqual(await read({ code: 0, stdout: encoded }),
    { status: "ready", identity: "12:42", entries: expected });
  for (const [exit, status] of [[43, "denied"], [44, "missing"], [45, "cycle"]]) {
    assert.deepEqual(await read({ code: exit }), { status });
  }
  for (const bytes of [Buffer.from("12:42\0f-truncated\0"), Buffer.from("invalid-id\0f-file\0\0"),
    Buffer.concat([Buffer.from("12:42\0f-"), Buffer.from([0xff, 0, 0])])]) {
    const response = { code: 0, stdout: bytes.toString("base64") };
    assert.deepEqual(await read(response), { status: "failed" });
  }
  assert.deepEqual(await readdir(appHome), ["mods"]);
});
