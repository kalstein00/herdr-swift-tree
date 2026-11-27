import { mkdir, rmdir, unlink } from "fs/promises";
import { connect } from "net";
import { appHome, exec, readTextFile } from "herdr";
import { windowsHelperPath } from "./windows-directory.js";

async function waitForEndpoint(file, current, cx) {
  const deadline = Date.now() + 4500;
  while (current() && Date.now() < deadline) {
    const text = await readTextFile(file);
    if (text !== null) {
      const response = JSON.parse(text);
      if (!Number.isInteger(response.port) || response.port < 1 || response.port > 65535
          || !/^[A-Za-z0-9+/]{22}==$/.test(response.token)) {
        throw new Error("Invalid Windows watcher endpoint.");
      }
      return response;
    }
    await new Promise(resolve => cx.timer.after(25, resolve));
  }
  throw new Error("Windows watcher did not start.");
}

export async function connectWindowsWatcher(folder, current, cx) {
  const home = appHome();
  const scratch = `${home}/.swifttree-watch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const endpoint = `${scratch}/endpoint.json`;
  await mkdir(scratch);
  try {
    if (!current()) return null;
    const { code } = await exec(windowsHelperPath(home), ["start-watch", folder, endpoint]);
    if (code !== 0) throw new Error("Could not launch the Windows watcher.");
    const { port, token } = await waitForEndpoint(endpoint, current, cx);
    if (!current()) return null;
    const socket = await connect("127.0.0.1", port);
    try {
      await socket.write(token);
      return socket;
    } catch (error) {
      socket.close();
      throw error;
    }
  } finally {
    await unlink(endpoint).catch(() => {});
    await unlink(`${endpoint}.tmp`).catch(() => {});
    await rmdir(scratch).catch(() => {});
  }
}

export async function readWindowsWatch(socket, onBatch) {
  let buffer = "";
  for (;;) {
    const bytes = await socket.read(8192);
    if (bytes === null) return;
    buffer += String.fromCharCode(...bytes);
    if (buffer.length > 2 * 1024 * 1024) throw new Error("Windows watcher batch exceeds its limit.");
    for (let end = buffer.indexOf("\n"); end !== -1; end = buffer.indexOf("\n")) {
      const message = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!message) continue;
      const paths = JSON.parse(message);
      if (!Array.isArray(paths) || paths.some(path => typeof path !== "string")) {
        throw new Error("Invalid Windows change batch.");
      }
      onBatch(paths);
    }
  }
}
