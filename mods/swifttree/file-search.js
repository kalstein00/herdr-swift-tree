import { mkdir, readFile, readdir, rmdir, unlink } from "fs/promises";
import { folderPrefix } from "./tree-folders.js";

function gitPathKey(path, ignoreCase) {
  return ignoreCase ? path.replace(/[A-Z]/g, letter => letter.toLowerCase()) : path;
}

async function removeGitSearchScratch(directory) {
  for (const name of await readdir(directory).catch(() => [])) {
    if (/^\d+$/.test(name)) await unlink(`${directory}/${name}`).catch(() => {});
  }
  await rmdir(directory).catch(() => {});
}

export async function windowsGitSearchScope(exec, helper, home, root) {
  const now = Date.now();
  const scratch = `${home}/.swifttree-search-${now}-${Math.random().toString(36).slice(2)}`;
  await mkdir(scratch);
  const files = new Set();
  const folders = new Set();
  try {
    const result = await exec(helper, ["git-search-scope", root, scratch]);
    if (result.code === 44) return null;
    if (result.code !== 0) throw new Error("Git file enumeration did not complete.");
    const { chunks, ignoreCase } = JSON.parse(result.stdout);
    if (!Number.isSafeInteger(chunks) || chunks < 0 || typeof ignoreCase !== "boolean") {
      throw new Error("Invalid Git file enumeration.");
    }
    for (let index = 0; index < chunks; index++) {
      const buffer = await readFile(`${scratch}/${index}`, "utf8");
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
  } finally {
    await removeGitSearchScratch(scratch);
  }
}

export async function collectLocalFiles(root, readDirectory, isCurrent, publish, readGitScope) {
  const rootScope = await readGitScope(root);
  const folders = [{ path: root, relative: "", policyPath: "", scope: rootScope }];
  const files = [];
  let lastPublication = 0;
  while (folders.length && isCurrent()) {
    const folder = folders.pop();
    const scope = folder.nestedRepository ? await readGitScope(folder.path) : folder.scope;
    if (!isCurrent()) return;
    const listing = await readDirectory(folder.path);
    if (!isCurrent()) return;
    if (listing.status !== "ready") continue;
    const prefix = folderPrefix(folder.path, "\\");
    for (const entry of listing.entries) {
      const path = prefix + entry.name;
      if (entry.name.toLowerCase() === ".git") continue;
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
  const letters = [...query.trim()].map(letter => letter.toLowerCase());
  if (!letters.length) return [];
  const matches = [];
  for (const file of files) {
    const name = [...file.name];
    const hits = [];
    let score = 0;
    for (let index = 0; index < name.length && hits.length < letters.length; index++) {
      if (name[index].toLowerCase() !== letters[hits.length]) continue;
      const previous = hits.at(-1);
      if (index === 0 || /[._ -]/.test(name[index - 1])) score += 5;
      if (previous === index - 1) score += 3;
      hits.push(index);
    }
    if (hits.length === letters.length) {
      matches.push({ file, hits, score: score - name.length / 100 });
    }
  }
  return matches.sort((left, right) => right.score - left.score ||
    left.file.name.localeCompare(right.file.name) || left.file.folder.localeCompare(right.file.folder));
}
