import { exec } from "herdr";
import { connectWindowsService, readWindowsMessages } from "./windows-watch-connection.js";

export async function resolveCorePid() {
  try {
    const { code, stdout } = await exec("hc", ["server", "status", "--json"], { timeout: 1500 });
    if (code === 0) {
      const { pid } = JSON.parse(stdout);
      if (Number.isInteger(pid) && pid > 0) return String(pid);
    }
  } catch {
    // Local reads are still available when the core is unavailable.
  }
  return "0";
}

export function createDirectoryAccess(cx) {
  let active = null;
  let startup = null;
  let restartAfter = 0;
  let closed = false;

  function start() {
    if (closed || startup || Date.now() < restartAfter) return startup;
    let ready;
    startup = new Promise(resolve => { ready = resolve; });
    cx.spawn(async cx => {
      const pending = new Map();
      let socket;
      try {
        const corePid = await resolveCorePid();
        socket = await connectWindowsService(["start-directory", corePid], () => !closed, cx);
        if (!socket || closed) return;
        active = { socket, pending, id: 0, writes: Promise.resolve() };
        ready(active);
        await readWindowsMessages(socket, reply => {
          const receive = pending.get(reply?.id);
          if (receive) receive(reply.listing ?? null);
        }, 16 * 1024 * 1024);
      } catch {
        // The existing one-shot readers remain usable on a broken connection.
      } finally {
        active = null;
        ready(null);
        for (const receive of pending.values()) receive(null);
        socket?.close();
        startup = null;
        restartAfter = Date.now() + 1000;
      }
    });
    return startup;
  }

  start();
  const requestDirectory = async request => {
    const connection = active ?? await start();
    if (closed) return { status: "cancelled" };
    if (!connection || connection.pending.size >= 32) return null;
    const { socket, pending } = connection;
    const id = ++connection.id;
    return new Promise(resolve => {
      const expiry = cx.timer.after(32000, () => {
        if (!pending.delete(id)) return;
        resolve(null);
        socket.close();
      });
      pending.set(id, listing => {
        pending.delete(id);
        expiry.cancel();
        resolve(closed ? { status: "cancelled" } : listing);
      });
      connection.writes = connection.writes.then(() => socket.write(JSON.stringify({ ...request, id }) + "\n")).catch(() => {
        pending.get(id)?.(null);
        socket.close();
      });
    });
  };
  requestDirectory.close = () => {
    closed = true;
    active?.socket.close();
  };
  return requestDirectory;
}
