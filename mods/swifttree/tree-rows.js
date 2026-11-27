import { folderEntryAt } from "./tree-folders.js";

function firstAfter(items, index, end) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (end(items[middle]) <= index) low = middle + 1;
    else high = middle;
  }
  return items[low];
}

// Store runs of siblings between expansions. Unopened rows need no layout
// records or full paths until the viewport or keyboard requests their index.
export function treeRows(root) {
  const segments = [];
  const byFolder = new Map();
  let length = 0;

  function append(folder, depth) {
    const listing = folder.listing;
    if (!listing) return;
    if (listing.status !== "ready" || !listing.entries.length) {
      segments.push({ folder, listing, depth, start: length, end: ++length, status: listing.status });
      return;
    }

    const siblings = [];
    byFolder.set(folder, siblings);
    const addRun = (from, to) => {
      if (from === to) return;
      const start = length;
      length += to - from;
      const run = { folder, listing, depth, from, to, start, end: length };
      siblings.push(run);
      segments.push(run);
    };

    let from = 0;
    for (const child of [...listing.expanded].sort((a, b) => a.index - b.index)) {
      addRun(from, child.index + 1);
      append(child, depth + 1);
      from = child.index + 1;
    }
    addRun(from, listing.entries.length);
  }

  if (root) append(root, 0);

  return {
    length,
    rowAt(index) {
      if (index < 0 || index >= length) return undefined;
      const { folder, listing, status, depth, from, start } = firstAfter(segments, index, run => run.end);
      if (status) return { key: `status:${folder.path}`, depth, status: status === "ready" ? "empty" : status };
      const entry = folderEntryAt(folder, listing, from + index - start);
      return { key: `entry:${entry.path}`, depth, entry, listing };
    },
    indexOf(entry) {
      const siblings = byFolder.get(entry?.parent);
      if (!siblings) return -1;
      const run = firstAfter(siblings, entry.index, segment => segment.to);
      if (run?.listing.retained.get(entry.index) !== entry) return -1;
      return run.start + entry.index - run.from;
    },
  };
}
