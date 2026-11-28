import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const output = new URL("./dist/", import.meta.url);
await mkdir(output, { recursive: true });
for (const name of await readdir(output)) {
  if (name === "editor.js" || name.startsWith("grammar-")) await rm(new URL(name, output));
}
const { metafile } = await build({
  entryPoints: ["editor.js"],
  outdir: "dist",
  chunkNames: "grammar-[hash]",
  bundle: true,
  minify: true,
  format: "esm",
  splitting: true,
  target: "edge100",
  metafile: true,
});
for (const name of ["index.html", "viewer.css"]) await copyFile(name, new URL(name, output));

const dependencies = new Set();
for (const input of Object.keys(metafile.inputs)) {
  const match = input.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (match) dependencies.add(match[1]);
}
const notices = [];
for (const name of [...dependencies].sort()) {
  const directory = `node_modules/${name}`;
  const files = (await readdir(directory)).filter(file => /^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(file));
  if (files.length === 0) throw new Error(`Missing license for ${name}`);
  for (const file of files.sort()) notices.push(`# ${name} / ${file}\n\n${(await readFile(`${directory}/${file}`, "utf8")).trim()}`);
}
await writeFile(new URL("THIRD-PARTY-NOTICES.txt", output), notices.join("\n\n") + "\n");
