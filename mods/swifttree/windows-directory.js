export function windowsHelperPath(appHome) {
  return `${appHome}/mods/swifttree/swifttree-windows.exe`;
}

async function runReader(exec, appHome, args) {
  try {
    const { code, stdout } = await exec(windowsHelperPath(appHome), args);
    if (code === 0) return JSON.parse(stdout);
  } catch {
    // Launch and incomplete-output failures have no directory listing.
  }
  return { status: "failed" };
}

export async function readWindowsDirectory(exec, appHome, folder, reason = "open", access) {
  const fast = await access?.({ folder, reason });
  if (fast) return fast;
  return runReader(exec, appHome, ["list", folder, reason]);
}

export function sortLinuxListing(exec, appHome, listingPath) {
  return runReader(exec, appHome, ["sort-linux", listingPath]);
}
