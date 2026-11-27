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

export async function connectWindowsService(args, current, cx) {
  const home = appHome();
  const scratch = `${home}/.swifttree-watch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const endpoint = `${scratch}/endpoint.json`;
  await mkdir(scratch);
  try {
    if (!current()) return null;
    const { code } = await exec(windowsHelperPath(home), [...args, endpoint]);
    if (code !== 0) throw new Error("Could not launch the Windows worker.");
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

export function connectWindowsWatcher(folder, current, cx) {
  return connectWindowsService(["start-watch", folder], current, cx);
}

export async function readWindowsMessages(socket, onMessage, limit = 2 * 1024 * 1024) {
  let parts = [];
  let length = 0;
  for (;;) {
    const bytes = await socket.read(8192);
    if (bytes === null) return;
    const chunk = String.fromCharCode(...bytes).split("\n");
    for (const [index, part] of chunk.entries()) {
      length += part.length;
      if (length > limit) throw new Error("Windows worker message exceeds its limit.");
      if (part) parts.push(part);
      if (index === chunk.length - 1) break;
      if (length) onMessage(JSON.parse(parts.join("")));
      parts = [];
      length = 0;
    }
  }
}

export function readWindowsWatch(socket, onBatch) {
  return readWindowsMessages(socket, paths => {
    if (!Array.isArray(paths) || paths.some(path => typeof path !== "string")) {
      throw new Error("Invalid Windows change batch.");
    }
    onBatch(paths);
  });
}
