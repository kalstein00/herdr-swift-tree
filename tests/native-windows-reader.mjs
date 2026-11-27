import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const build = fileURLToPath(new URL("../scripts/build-swifttree-windows.ps1", import.meta.url));

export async function buildWindowsReader(appHome) {
  const mod = join(appHome, "mods", "swifttree");
  await mkdir(mod, { recursive: true });
  await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", build, "-OutputPath", join(mod, "swifttree-windows.exe")]);
}
