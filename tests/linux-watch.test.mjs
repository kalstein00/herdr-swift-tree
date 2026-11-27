import assert from "node:assert/strict";
import test from "node:test";
import { readLinuxWatch, reconcileLinuxWatch } from "../mods/swifttree/linux-watch.js";

test("samples literal remote folder paths and carries each fingerprint across requests", async () => {
  const root = { path: "/workspace" };
  const child = { path: "/workspace/a folder's\nchild" };
  const folders = [root, child];
  const fingerprint = "12:37:2026-11-28 01:01:01 +0000:2026-11-28 01:01:01 +0000";
  const prior = new Map([[root, fingerprint]]);

  const result = await readLinuxWatch(async (command, argv, options) => {
    assert.equal(command, "sh");
    assert.equal(argv[0], "-c");
    assert.deepEqual(argv.slice(2), ["swifttree-remote-watch", `${fingerprint}\n`, "4", root.path, child.path]);
    assert.deepEqual(options, { on: "test-linux", timeout: 8000 });
    return { code: 0, stdout: `${fingerprint}\n?\n` };
  }, "test-linux", folders, prior, () => true);

  assert.deepEqual(result, { fingerprints: new Map([[root, fingerprint], [child, "?"]]), longPoll: true });
});

test("rejects an incomplete probe without returning a partial batch", async () => {
  const folders = [{ path: "/workspace" }, { path: "/workspace/child" }];
  await assert.rejects(
    readLinuxWatch(async () => ({ code: 0, stdout: "?\n" }), "test-linux", folders, new Map(), () => true),
    /Could not watch remote folder metadata/,
  );
});

test("bounds command arguments and stops taking samples after a root retires", async () => {
  const folders = Array.from({ length: 30 }, (_, n) => ({ path: `/${n}/${"a".repeat(400)}` }));
  let current = true;
  let requests = 0;
  const result = await readLinuxWatch(async (_command, argv) => {
    requests++;
    assert.equal(argv[4], "1");
    assert.ok(argv.slice(5).length < folders.length);
    current = false;
    return { code: 0, stdout: "?\n".repeat(argv.slice(5).length) };
  }, "test-linux", folders, new Map(), () => current);
  assert.equal(requests, 1);
  assert.equal(result, null);
});

test("retries a failed listing even with unchanged metadata and skips reconciled folders", async () => {
  const root = { path: "/workspace" };
  const child = { path: "/workspace/child" };
  const sampled = new Map([[root, "root metadata"], [child, "child metadata"]]);
  const previous = new Map([[root, "old root"], [child, "old child"]]);
  const attempted = [];

  const failed = await reconcileLinuxWatch(sampled, previous, async folder => {
    attempted.push(folder);
    return folder === root;
  });
  assert.equal(failed, true);
  assert.deepEqual(attempted, [root, child]);
  assert.deepEqual(previous, new Map([[root, "root metadata"]]));

  attempted.length = 0;
  const retried = await reconcileLinuxWatch(sampled, previous, async folder => {
    attempted.push(folder);
    return true;
  });
  assert.equal(retried, false);
  assert.deepEqual(attempted, [child]);
  assert.deepEqual(previous, sampled);
});
