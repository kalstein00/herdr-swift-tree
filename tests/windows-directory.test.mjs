import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
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

  const endpoint = join(root, "directory-endpoint.json");
  const executable = join(root, "mods", "swifttree", "swifttree-windows.exe");
  await writeFile(join(root, "connect"), `
    const { writeFileSync } = require("node:fs");
    process.stdin.once("data", () => writeFileSync("blocked-" + process.pid, ""));
    process.stdin.resume();
  `);
  const encoded = [process.pid, endpoint].map(value => Buffer.from(String(value)).toString("base64"));
  const server = spawn(executable, ["directory-worker", ...encoded], { cwd: root, windowsHide: true, stdio: "ignore" });
  const exit = once(server, "exit");
  let blocked = [];
  try {
    let ready;
    for (let attempt = 0; attempt < 40 && !ready; attempt++) {
      ready = await readFile(endpoint, "utf8").then(JSON.parse, error => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
      if (!ready) await setTimeout(25);
    }
    assert.ok(ready, "resident directory worker must publish a rendezvous endpoint");
    const socket = connect(ready.port, "127.0.0.1");
    socket.setTimeout(3000, () => socket.destroy(new Error("Directory worker response timed out")));
    try {
      await once(socket, "connect");
      const lines = createInterface({ input: socket, crlfDelay: Infinity });
      const responses = new Map();
      const requests = [{ id: 1, folder }, { id: 2, folder: join(folder, "missing") }];
      socket.write(ready.token + requests.map(request => JSON.stringify(request) + "\n").join(""));
      for await (const line of lines) {
        if (!line) continue;
        const { id, listing } = JSON.parse(line);
        responses.set(id, listing);
        if (responses.size === requests.length) break;
      }
      assert.deepEqual(responses.get(1), { status: "ready", entries: expected });
      assert.deepEqual(responses.get(2), { status: "missing" });

      socket.write([3, 4].map(id => JSON.stringify({
        id, machine: "stalled-test-core", folder: "/synthetic", script: "exit 1",
      }) + "\n").join(""));
      for (let attempt = 0; attempt < 40 && blocked.length < 2; attempt++) {
        blocked = (await readdir(root)).filter(name => /^blocked-\d+$/.test(name))
          .map(name => Number(name.slice("blocked-".length)));
        if (blocked.length < 2) await setTimeout(25);
      }
      assert.equal(blocked.length, 2, "both bridge reads must be waiting when the client closes");
    } finally {
      socket.destroy();
    }
    assert.deepEqual(await Promise.race([exit, setTimeout(3000, null, { ref: false })]), [0, null]);
    for (const pid of blocked) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    if (server.exitCode == null && server.signalCode == null) server.kill();
    await exit;
  }
});
