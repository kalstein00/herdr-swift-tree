import CherryEngine from "cherry-markdown/dist/cherry-markdown.engine.core.esm.js";
import MermaidPlugin from "cherry-markdown/dist/addons/cherry-code-block-mermaid-plugin.esm.js";
import DOMPurify from "dompurify";
import katex from "katex";
import mermaid from "mermaid";

const dark = matchMedia("(prefers-color-scheme: dark)").matches;
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  htmlLabels: false,
  theme: dark ? "dark" : "default",
});
let diagramSequence = 0;

function followDocumentLink(article, event) {
  const link = event.target.closest("a[href^='#']");
  if (!link) return;
  event.preventDefault();
  const fragment = link.getAttribute("href").slice(1);
  let decoded = fragment;
  let target;
  if (fragment) {
    try {
      decoded = decodeURIComponent(fragment);
    } catch {
      // Malformed percent escapes still allow an exact ID match.
    }
    const cherryFragment = fragment.replace(/%[a-f\d]{2}/gi, escape => escape.toUpperCase());
    for (const id of [fragment, decoded, cherryFragment, `safe_${cherryFragment}`, `safe_${decoded}`]) {
      target = article.querySelector(`#${CSS.escape(id)}`);
      if (target) break;
    }
  }
  if (!target && (!decoded || decoded.toLowerCase() === "top")) target = article.parentElement;
  if (target) {
    if (target !== article.parentElement) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    if (target === article.parentElement) target.scrollTop = 0;
    else target.scrollIntoView({ block: "start" });
  }
}

export function renderMarkdown(source) {
  const article = document.createElement("article");
  article.className = `cherry cherry-markdown ${dark ? "theme__dark" : "theme__default"}`;
  // Cherry otherwise uses mermaidAPI.render, which bypasses Mermaid's shared render queue.
  const mermaidAPI = {
    initialize() {},
    async render(pluginId, source, canvas) {
      if (!article.isConnected) throw new Error("The document was closed");
      return mermaid.render(`${pluginId}-${++diagramSequence}`, source, canvas);
    },
  };
  const engine = new CherryEngine({
    externals: { katex },
    engine: {
      syntax: {
        header: { anchorStyle: "none" },
        codeBlock: {
          copyCode: false,
          mermaid: { src: "", svg2img: true, showSourceToolbar: false },
          customRenderer: {
            mermaid: new MermaidPlugin({
              mermaidAPI, mermaidCanvasAppendDom: article,
            }),
          },
        },
        mathBlock: { engine: "katex", src: "", css: "" },
        inlineMath: { engine: "katex", src: "" },
      },
    },
  });
  // Keep the plug-in's asynchronous replacements within this file's detached article.
  engine.$cherry.wrapperDom = article;
  const body = DOMPurify.sanitize(engine.makeHtml(source), {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ["style", "form"],
  });
  for (const link of body.querySelectorAll("a[href]")) {
    if (!link.getAttribute("href").startsWith("#")) link.removeAttribute("href");
    link.removeAttribute("target");
  }
  article.append(body);
  article.addEventListener("click", event => followDocumentLink(article, event));
  return article;
}
