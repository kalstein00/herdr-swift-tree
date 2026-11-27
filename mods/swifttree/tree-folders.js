export function openedTreeFolders(root) {
  const opened = [];
  const pending = [root];
  while (pending.length) {
    const folder = pending.pop();
    opened.push(folder);
    if (folder.listing?.status === "ready") {
      for (const child of folder.listing.entries) {
        if (child.open) pending.push(child);
      }
    }
  }
  return opened;
}

export function isOpenTreeFolder(folder, root) {
  for (let entry = folder; entry !== root; entry = entry.parent) {
    if (!entry.open || !entry.parent?.listing?.entries?.includes(entry)) return false;
  }
  return true;
}
