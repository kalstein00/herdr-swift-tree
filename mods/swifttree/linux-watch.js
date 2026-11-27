const sampleDirectories = String.raw`
previous=$1
limit=$2
shift 2
command -v stat >/dev/null || exit 127

fingerprints() {
    if values=$(LC_ALL=C TZ=UTC stat -L --printf '%d:%i:%y:%z\n' -- "$@" 2>/dev/null); then
        printf '%s\n' "$values"
        return
    fi
    LC_ALL=C TZ=UTC stat -L --printf '' -- / >/dev/null 2>&1 || return 2
    for folder do
        LC_ALL=C TZ=UTC stat -L --printf '%d:%i:%y:%z\n' -- "$folder" 2>/dev/null || printf '?\n'
    done
}

checks=0
while [ "$checks" -lt "$limit" ]; do
    checks=$((checks + 1))
    current=$(fingerprints "$@") || exit $?
    if [ "$current" != "$previous" ] || [ "$checks" -eq "$limit" ]; then
        printf '%s\n' "$current"
        exit
    fi
    sleep 0.10
done
`;

function directoryBatches(folders, previous) {
  const batches = [[]];
  let size = 0;
  for (const folder of folders) {
    const fingerprint = previous.get(folder) ?? "";
    // The Windows process carries both these arguments and the fixed shell program.
    const argumentSize = 2 * (folder.path.length + fingerprint.length) + 8;
    if (size && size + argumentSize > 18000) {
      batches.push([]);
      size = 0;
    }
    batches.at(-1).push(folder);
    size += argumentSize;
  }
  return batches;
}

export async function readLinuxWatch(exec, machine, folders, previous, current) {
  const batches = directoryBatches(folders, previous);
  const longPoll = batches.length === 1;
  const fingerprints = new Map();
  for (const batch of batches) {
    if (!current()) return null;
    const baseline = batch.map(folder => previous.get(folder) ?? "").join("\n");
    const { code, stdout } = await exec("sh", ["-c", sampleDirectories, "swifttree-remote-watch",
      baseline, longPoll ? "20" : "1", ...batch.map(folder => folder.path),
    ], { on: machine, timeout: 8000 });
    const rows = stdout.trimEnd().split("\n");
    if (code !== 0 || rows.length !== batch.length || rows.some(row => !/^(?:[0-9]+:[0-9]+:.+|\?)$/.test(row))) {
      throw new Error("Could not watch remote folder metadata.");
    }
    batch.forEach((folder, index) => fingerprints.set(folder, rows[index]));
  }
  return { fingerprints, longPoll };
}

export async function reconcileLinuxWatch(fingerprints, previous, reload) {
  let failed = false;
  for (const [folder, fingerprint] of fingerprints) {
    if (previous.get(folder) === fingerprint) continue;
    const applied = await reload(folder, previous.has(folder));
    if (applied === true) previous.set(folder, fingerprint);
    if (applied === false) {
      previous.delete(folder);
      failed = true;
    }
  }
  return failed;
}
