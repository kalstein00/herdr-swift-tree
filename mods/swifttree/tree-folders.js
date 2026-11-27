export function makeEntry(path, name, directory, parent = null, index = -1) {
  return { path, name, directory, parent, index, open: false, listing: null, request: null };
}

export function setFolderListing(folder, result, separator) {
  if (result.status !== "ready") {
    folder.listing = result;
    return;
  }

  const prefix = folder.path.replace(separator === "/" ? /\/+$/ : /[\\/]+$/, "");
  const retained = new Map();
  const expanded = new Set();
  const previous = folder.listing?.retained;
  if (previous?.size) {
    const byName = new Map([...previous.values()].map(entry => [entry.name, entry]));
    for (let index = 0; index < result.entries.length && byName.size; index++) {
      const { name, directory } = result.entries[index];
      const entry = byName.get(name);
      if (!entry) continue;
      byName.delete(name);
      if (entry.directory !== directory) continue;
      entry.index = index;
      retained.set(index, entry);
      if (entry.open) expanded.add(entry);
    }
  }
  folder.listing = { ...result, prefix: prefix + separator, retained, expanded };
}

export function folderEntryAt(folder, listing, index) {
  const remembered = listing.retained.get(index);
  if (remembered) return remembered;
  const { name, directory } = listing.entries[index];
  return makeEntry(listing.prefix + name, name, directory, folder, index);
}

export function retainEntry(entry) {
  entry.parent.listing.retained.set(entry.index, entry);
  return entry;
}

export function releaseEntry(entry) {
  if (!entry || entry.open) return;
  const retained = entry.parent.listing?.retained;
  if (retained?.get(entry.index) === entry) retained.delete(entry.index);
}

export function setFolderOpen(folder, open) {
  folder.open = open;
  if (open) {
    folder.parent.listing.expanded.add(retainEntry(folder));
  } else {
    folder.parent.listing.expanded.delete(folder);
    folder.request = null;
    folder.listing = null;
  }
}

export function openedTreeFolders(root) {
  const opened = [];
  const pending = [root];
  while (pending.length) {
    const folder = pending.pop();
    opened.push(folder);
    for (const child of folder.listing?.expanded ?? []) pending.push(child);
  }
  return opened;
}

export function isOpenTreeFolder(folder, root) {
  for (let entry = folder; entry !== root; entry = entry.parent) {
    if (!entry.open || !entry.parent?.listing?.expanded?.has(entry)) return false;
  }
  return true;
}
