import { mkdir, rmdir, unlink, writeFile } from "fs/promises";
import { sortLinuxListing } from "./windows-directory.js";

const listFolder = String.raw`
probe_folder() {
    if [ -d "$1" ]; then
        [ -r "$1" ] && [ -x "$1" ] && return 0
        return 43
    fi

    # A failed -d also covers an unreadable ancestor. Ask find for the path error.
    detail=$(LC_ALL=C find -H "$1/" -maxdepth 0 2>&1 >/dev/null)
    if [ "$?" -eq 0 ]; then return 0; fi
    case "$detail" in
        *": Permission denied") return 43 ;;
        *": No such file or directory"|*": Not a directory") return 44 ;;
        *) return 1 ;;
    esac
}

probe_folder "$1" || exit $?
cd -P "$1" || {
    probe_folder "$1" || exit $?
    exit 1
}
identity=$(LC_ALL=C find -P . -maxdepth 0 -printf '%D:%i') || exit $?
case ",$2," in
    *",$identity,"*) exit 45 ;;
esac
printf '%s\0' "$identity"
find -P . -mindepth 1 -maxdepth 1 \( -type l -printf 'l%Y%f\0' \) -o -printf '%y-%f\0' || {
    probe_folder "$1" || exit $?
    exit 1
}
probe_folder "$1" || exit $?
current=$(LC_ALL=C find -H "$1" -maxdepth 0 -printf '%D:%i') || exit $?
[ "$current" = "$identity" ] || exit 1
printf '\0'
`;

export async function readLinuxDirectory(exec, appHome, folder, machine, access, ancestors = "") {
  if (!folder.startsWith("/")) return { status: "failed" };
  try {
    const fast = await access?.({ machine, folder, script: listFolder, ancestors });
    if (fast) return fast;
    // Keep the core's base64 output so names are decoded strictly on Windows.
    const { stdout } = await exec("hc", [
      "exec", "--json", "--on", machine, "--", "sh", "-c", listFolder, "swifttree", folder, ancestors,
    ]);
    const response = JSON.parse(stdout);
    if (response.timed_out) return { status: "failed" };
    if (response.code === 43) return { status: "denied" };
    if (response.code === 44) return { status: "missing" };
    if (response.code === 45) return { status: "cycle" };
    if (response.code !== 0 || typeof response.stdout !== "string") return { status: "failed" };

    const scratch = `${appHome}/.swifttree-list-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listingPath = `${scratch}/entries`;
    await mkdir(scratch);
    try {
      await writeFile(listingPath, response.stdout);
      return await sortLinuxListing(exec, appHome, listingPath);
    } finally {
      await unlink(listingPath).catch(() => {});
      await rmdir(scratch).catch(() => {});
    }
  } catch {
    return { status: "failed" };
  }
}
