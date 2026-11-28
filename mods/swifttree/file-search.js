import { folderPrefix } from "./tree-folders.js";

export async function collectLocalFiles(root, readDirectory, isCurrent, publish) {
  const folders = [{ path: root, relative: "" }];
  const files = [];
  let lastPublication = 0;
  while (folders.length && isCurrent()) {
    const folder = folders.pop();
    const listing = await readDirectory(folder.path);
    if (!isCurrent()) return;
    if (listing.status !== "ready") continue;
    const prefix = folderPrefix(folder.path, "\\");
    for (const entry of listing.entries) {
      const path = prefix + entry.name;
      if (entry.name.toLowerCase() === ".git") continue;
      if (entry.directory) {
        if (!entry.link) {
          const relative = folder.relative ? folder.relative + "/" + entry.name : entry.name;
          folders.push({ path, relative });
        }
      } else if (!entry.targetUnknown) {
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
