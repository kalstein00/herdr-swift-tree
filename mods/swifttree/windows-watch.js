import { openedTreeFolders } from "./tree-folders.js";

function windowsPathKey(path) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  if (normalized.startsWith("//?/unc/")) return `//${normalized.slice(8)}`;
  if (normalized.startsWith("//?/")) return normalized.slice(4);
  return normalized;
}

export function affectedWindowsFolders(root, paths) {
  const opened = openedTreeFolders(root);
  const rootKey = windowsPathKey(root.path);
  const changes = new Set(paths.map(windowsPathKey));
  if (!changes.size || [...changes].some(path => !path.startsWith(`${rootKey}/`))) {
    return { reason: "recovery", folders: opened };
  }

  const changedParents = new Set([...changes].map(path => path.slice(0, path.lastIndexOf("/"))));
  const folders = opened.filter(folder => {
    const key = windowsPathKey(folder.path);
    if (changedParents.has(key)) return true;
    // A moved or replaced directory can retain the names of its expanded children.
    for (let ancestor = key; ancestor.length > rootKey.length; ancestor = ancestor.slice(0, ancestor.lastIndexOf("/"))) {
      if (changes.has(ancestor)) return true;
    }
    return false;
  });
  return { reason: "change", folders };
}
