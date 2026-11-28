import { mkdir, readFile, readdir, rmdir, unlink } from "fs/promises";
import { folderPrefix } from "./tree-folders.js";

function gitPathKey(path, ignoreCase) {
  return ignoreCase ? path.replace(/[A-Z]/g, letter => letter.toLowerCase()) : path;
}

async function readGitScope(chunks, ignoreCase, readChunk, current) {
  if (!Number.isSafeInteger(chunks) || chunks < 0 || typeof ignoreCase !== "boolean") {
    throw new Error("Invalid Git file enumeration.");
  }
  const files = new Set();
  const folders = new Set();
  for (let index = 0; index < chunks; index++) {
    if (!current()) return null;
    const buffer = await readChunk(index);
    if (!buffer.endsWith("\0")) throw new Error("Incomplete Git file enumeration.");
    for (const path of buffer.split("\0")) {
      if (!path) continue;
      const normalized = gitPathKey(path.replace(/\/$/, ""), ignoreCase);
      files.add(normalized);
      for (let end = normalized.lastIndexOf("/"); end > 0; end = normalized.lastIndexOf("/", end - 1)) {
        const parent = normalized.slice(0, end);
        if (folders.has(parent)) break;
        folders.add(parent);
      }
    }
  }
  return { files, folders, ignoreCase };
}

async function removeGitSearchScratch(directory) {
  for (const name of await readdir(directory).catch(() => [])) {
    if (/^\d+$/.test(name)) await unlink(`${directory}/${name}`).catch(() => {});
  }
  await rmdir(directory).catch(() => {});
}

export async function windowsGitSearchScope(exec, helper, home, root, current) {
  const now = Date.now();
  const scratch = `${home}/.swifttree-search-${now}-${Math.random().toString(36).slice(2)}`;
  await mkdir(scratch);
  try {
    const result = await exec(helper, ["git-search-scope", root, scratch]);
    if (result.code === 44) return null;
    if (result.code !== 0) throw new Error("Git file enumeration did not complete.");
    const { chunks, ignoreCase } = JSON.parse(result.stdout);
    return await readGitScope(chunks, ignoreCase, index => readFile(`${scratch}/${index}`, "utf8"), current);
  } finally {
    await removeGitSearchScratch(scratch);
  }
}

const prepareLinuxGitScope = String.raw`
command -v git >/dev/null || exit 44
cd -P "$1" || exit 1
probe=$(LC_ALL=C git rev-parse --is-inside-work-tree 2>&1) || {
    case "$probe" in *"not a git repository"*) exit 44;; esac
    exit 1
}
[ "$probe" = true ] || exit 44
find /tmp -regextype posix-extended -maxdepth 1 -type d -uid "$(id -u)" -mmin +10 \
    -regex '/tmp/\.swifttree-search-[0-9]{13}-[a-z0-9]+' -exec sh -c '
        for old do
            find "$old" -maxdepth 1 -type f \( -name "paths" -o -name "chunk-*" \) -delete
            rmdir -- "$old"
        done
    ' sh {} + 2>/dev/null
umask 077
mkdir -- "$2" || exit 1
git -c core.fsmonitor=false ls-files -z --cached --others --exclude-standard > "$2/paths" || exit 1
ignore_case=$(git config --bool --get core.ignorecase)
[ "$ignore_case" = true ] || ignore_case=false
if [ -s "$2/paths" ]; then
    split -d -a 8 -t '\0' -C 512K -- "$2/paths" "$2/chunk-" || exit 1
fi
rm -- "$2/paths" || exit 1
count=$(find "$2" -maxdepth 1 -type f -name 'chunk-*' -printf . | wc -c)
printf '{"chunks":%s,"ignoreCase":%s}\n' "$count" "$ignore_case"
`;

const clearLinuxGitScope = String.raw`
[ -d "$1" ] && [ ! -L "$1" ] || exit 0
find "$1" -maxdepth 1 -type f \( -name 'paths' -o -name 'chunk-*' \) -delete
rmdir -- "$1"
`;

export async function linuxGitSearchScope(exec, root, machine, current) {
  const on = { on: machine };
  const scratch = `/tmp/.swifttree-search-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let attempted = true;
  try {
    const result = await exec("sh", ["-c", prepareLinuxGitScope, "swifttree", root, scratch], on);
    if (result.code === 44) { attempted = false; return null; }
    if (result.code !== 0) throw new Error("Remote Git file enumeration did not complete.");
    const { chunks, ignoreCase } = JSON.parse(result.stdout);
    return await readGitScope(chunks, ignoreCase, async index => {
      const suffix = String(index).padStart(8, "0");
      const reply = await exec("cat", [`${scratch}/chunk-${suffix}`], on);
      if (reply.code !== 0) throw new Error("Could not read the remote Git file list.");
      return reply.stdout;
    }, current);
  } finally {
    if (attempted) await exec("sh", ["-c", clearLinuxGitScope, "swifttree", scratch], on).catch(() => {});
  }
}

export async function collectFiles(root, separator, readDirectory, isCurrent, publish, readGitScope) {
  const components = root.split(separator === "/" ? "/" : /[\\/]/);
  if (components.some(name => gitPathKey(name, separator === "\\") === ".git")) return;
  const rootScope = await readGitScope(root);
  const folders = [{ path: root, relative: "", policyPath: "", scope: rootScope }];
  const files = [];
  let lastPublication = 0;
  while (folders.length && isCurrent()) {
    const folder = folders.pop();
    const listing = await readDirectory(folder.path, Boolean(folder.relative));
    if (!isCurrent()) return;
    if (listing.status !== "ready") continue;
    const scope = folder.nestedRepository ? await readGitScope(folder.path) : folder.scope;
    if (!isCurrent()) return;
    const prefix = folderPrefix(folder.path, separator);
    for (const entry of listing.entries) {
      const path = prefix + entry.name;
      if (gitPathKey(entry.name, separator === "\\") === ".git") continue;
      const relative = folder.relative ? folder.relative + "/" + entry.name : entry.name;
      const policyPath = folder.policyPath ? folder.policyPath + "/" + entry.name : entry.name;
      const policyKey = gitPathKey(policyPath, scope?.ignoreCase);
      if (entry.directory) {
        if (entry.link) continue;
        if (!scope || scope.folders.has(policyKey)) {
          folders.push({ path, relative, policyPath, scope });
        } else if (scope.files.has(policyKey)) {
          folders.push({ path, relative, policyPath: "", nestedRepository: true });
        }
      } else if (!entry.targetUnknown && (!scope || scope.files.has(policyKey))) {
        files.push({ name: entry.name, path, folder: folder.relative });
      }
    }
    const now = Date.now();
    if (now - lastPublication >= 80) {
      publish(files);
      lastPublication = now;
    }
  }
  if (isCurrent()) publish(files);
}

export function matchingFiles(files, query) {
  const input = query.trim();
  const quoted = input.startsWith('"') && input.endsWith('"');
  const letters = [...input.replaceAll('"', "")].map(letter => letter.toLowerCase());
  if (!letters.length) return [];
  const matches = [];
  for (const file of files) {
    const name = [...file.name];
    const foldedName = name.map(letter => letter.toLowerCase());
    const start = foldedName.findIndex((letter, index) =>
      letter === letters[0] && letters.every((expected, offset) => foldedName[index + offset] === expected));
    if (start >= 0) {
      const hits = letters.map((_, offset) => start + offset);
      matches.push({ file, hits, rank: start === 0 ? 2 : 1, score: -name.length });
      continue;
    }
    if (quoted) continue;

    const hits = [];
    let score = 0;
    for (let index = 0; index < name.length && hits.length < letters.length; index++) {
      if (foldedName[index] !== letters[hits.length]) continue;
      const previous = hits.at(-1);
      if (index === 0 || /[._ -]/.test(name[index - 1])) score += 5;
      if (previous === index - 1) score += 3;
      hits.push(index);
    }
    if (hits.length === letters.length) {
      matches.push({ file, hits, rank: 0, score: score - name.length / 100 });
    }
  }
  return matches.sort((left, right) => right.rank - left.rank || right.score - left.score ||
    left.file.name.localeCompare(right.file.name) || left.file.folder.localeCompare(right.file.folder));
}
