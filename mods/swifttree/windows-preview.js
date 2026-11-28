import { connectWindowsService, readWindowsMessages } from "./windows-watch-connection.js";
import { appHome, exec } from "herdr";
import { resolveCorePid } from "./directory-access.js";
import { windowsHelperPath } from "./windows-directory.js";

export async function warmWindowsPreview(cx) {
  const home = appHome();
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await exec(windowsHelperPath(home), ["warm-preview", home]).catch(() => null);
    if (result?.code !== 3) return;
    await new Promise(resolve => cx.timer.after(100, resolve));
  }
}

export function createWindowsPreview(cx) {
  let closed = false;
  let socket = null;
  let startup = null;
  let writes = Promise.resolve();
  let nextId = 0;
  const pending = new Map();

  function start() {
    if (closed || startup) return startup;
    let connected;
    startup = new Promise(resolve => { connected = resolve; });
    cx.spawn(async cx => {
      try {
        socket = await connectWindowsService(["start-preview"], () => !closed, cx);
        connected(socket);
        if (socket) await readWindowsMessages(socket, reply => pending.get(reply?.id)?.(reply.result ?? null));
      } catch {
        // An unavailable viewer leaves the Files panel interactive.
      } finally {
        connected(null);
        socket?.close();
        socket = null;
        startup = null;
        for (const finish of pending.values()) finish(null);
      }
    });
    return startup;
  }

  function send(command, current = () => true) {
    const write = writes.then(async () => {
      const connection = socket ?? await start();
      if (!connection || closed || !current()) return false;
      await connection.write(JSON.stringify(command) + "\n");
      return true;
    }).catch(() => {
      socket?.close();
      return false;
    });
    writes = write;
    return write;
  }

  function request(command, current = () => true) {
    const id = ++nextId;
    return new Promise(resolve => {
      const finish = result => {
        if (!pending.delete(id)) return;
        expiry.cancel();
        resolve(result);
      };
      const expiry = cx.timer.after(command.action === "open" ? 5000 : 15000, () => finish(null));
      pending.set(id, finish);
      send({ ...command, id }, () => pending.has(id) && current()).then(sent => { if (!sent) finish(null); });
    });
  }

  start();
  return {
    async read(path, machine) {
      const corePid = machine ? await resolveCorePid() : null;
      const result = await request({ action: "read", path, machine, corePid });
      return result && { ...result, corePid };
    },
    open(file, current) {
      return request({ action: "open", name: file.name, path: file.path, version: file.version,
        prefixHash: file.prefixHash, machine: file.machine, corePid: file.corePid }, current);
    },
    hide() {
      if (startup) void send({ action: "hide" });
    },
    close() {
      closed = true;
      socket?.close();
    },
  };
}
