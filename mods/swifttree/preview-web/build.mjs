import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const output = new URL("./dist/", import.meta.url);
await mkdir(output, { recursive: true });
for (const name of await readdir(output)) {
  if (name === "editor.js" || name === "markdown-style.css" || /^(?:grammar|chunk|asset)-/.test(name)) {
    await rm(new URL(name, output));
  }
}
const { metafile } = await build({
  entryPoints: ["editor.js", "markdown-style.css"],
  outdir: "dist",
  chunkNames: "chunk-[hash]",
  assetNames: "asset-[name]-[hash]",
  loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
  bundle: true,
  minify: true,
  format: "esm",
  splitting: true,
  target: "edge100",
  metafile: true,
  plugins: [{
    name: "preserve-cherry-inline-math-spacing",
    setup(builder) {
      builder.onLoad({ filter: /cherry-markdown\.engine\.core\.esm\.js$/ }, async ({ path }) => {
        const source = await readFile(path, "utf8");
        // Cherry 0.11.14 consumes the first whitespace after the closing math delimiter.
        const original = String.raw`end:"(\\s*)~D(?:\\s{0,1})"`;
        const replacement = String.raw`end:"(\\s*)~D"`;
        if (source.split(original).length !== 2) throw new Error("Review the Cherry inline math spacing patch");
        return { contents: source.replace(original, replacement), loader: "js" };
      });
    },
  }],
});
for (const name of ["index.html", "viewer.css"]) await copyFile(name, new URL(name, output));

const dependencies = new Set();
for (const input of Object.keys(metafile.inputs)) {
  const match = input.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (match) dependencies.add(match[1]);
}
const notices = [];
for (const name of [...dependencies].sort()) {
  if (name === "cherry-markdown") {
    // The npm tarball omits the upstream license file.
    notices.push(`# cherry-markdown / LICENSE\n\nSwiftTree modifies the bundled Cherry engine to preserve whitespace following inline math.\n\n${(await readFile("cherry-markdown-LICENSE", "utf8")).trim()}`);
    continue;
  }
  const directory = `node_modules/${name}`;
  const files = (await readdir(directory)).filter(file => /^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(file));
  if (files.length === 0) throw new Error(`Missing license for ${name}`);
  for (const file of files.sort()) notices.push(`# ${name} / ${file}\n\n${(await readFile(`${directory}/${file}`, "utf8")).trim()}`);
}
await writeFile(new URL("THIRD-PARTY-NOTICES.txt", output), notices.join("\n\n") + "\n");
