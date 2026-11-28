import CherryEngine from "cherry-markdown/dist/cherry-markdown.engine.core.esm.js";
import MermaidPlugin from "cherry-markdown/dist/addons/cherry-code-block-mermaid-plugin.esm.js";
import DOMPurify from "dompurify";

const dark = matchMedia("(prefers-color-scheme: dark)").matches;
let mermaidRuntime;
let diagramSequence = 0;

function loadMermaid() {
  return mermaidRuntime ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      theme: dark ? "dark" : "default",
    });
    return mermaid;
  });
}

class DeferredMermaid {
  static TYPE = MermaidPlugin.TYPE;

  constructor(placeholder) {
    this.placeholder = placeholder;
  }

  render(source, sign, engine, { mermaidConfig }) {
    return this.placeholder({ type: "diagram", source, sign, engine, mermaidConfig });
  }
}

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

export function mountMarkdown(viewport, source) {
  const article = document.createElement("article");
  article.className = `cherry cherry-markdown ${dark ? "theme__dark" : "theme__default"}`;
  const jobs = new Map();
  const renderId = crypto.randomUUID();
  let nextJob = 0;
  function placeholder(job) {
    const id = `${renderId}-${++nextJob}`;
    jobs.set(id, job);
    const format = job.type === "diagram" ? "diagram" : job.displayMode ? "math-block" : "math-inline";
    return `<span class="preview-${format}" data-preview-work="${id}">…</span>`;
  }

  // Cherry otherwise uses mermaidAPI.render, which bypasses Mermaid's shared render queue.
  const mermaidAPI = {
    initialize() {},
    async render(pluginId, source, canvas) {
      const mermaid = await loadMermaid();
      if (!article.isConnected) throw new Error("The document was closed");
      return mermaid.render(`${pluginId}-${++diagramSequence}`, source, canvas);
    },
  };
  let diagram;

  async function renderNode(node, job) {
    try {
      if (job.type === "math") {
        const { default: katex } = await import("katex");
        if (!node.isConnected) return;
        katex.render(job.source, node, { displayMode: job.displayMode, throwOnError: false, trust: false });
        return;
      }
      await loadMermaid();
      if (!node.isConnected) return;
      diagram ??= new MermaidPlugin({ mermaidAPI, mermaidCanvasAppendDom: article });
      const display = html => {
        if (!node.isConnected) return;
        if (html) node.innerHTML = html;
        else node.textContent = job.source;
      };
      const cached = diagram.render(job.source, job.sign, job.engine, {
        mermaidConfig: job.mermaidConfig,
        showSourceToolbar: false,
        updateCache: display,
        fallback: () => "",
      });
      if (cached) display(cached);
    } catch {
      if (node.isConnected) node.textContent = job.source;
    }
  }

  const engine = new CherryEngine({
    externals: {
      katex: {
        renderToString(text, { displayMode = false }) {
          return placeholder({ type: "math", source: text, displayMode });
        },
      },
    },
    engine: {
      syntax: {
        header: { anchorStyle: "none" },
        codeBlock: {
          copyCode: false,
          mermaid: { src: "", svg2img: true, showSourceToolbar: false },
          customRenderer: { mermaid: new DeferredMermaid(placeholder) },
        },
        mathBlock: { engine: "katex", src: "", css: "" },
        inlineMath: { engine: "katex", src: "" },
      },
    },
  });
  // Cherry resolves cross-references and fenced blocks once using the complete file.
  engine.$cherry.wrapperDom = article;
  const body = DOMPurify.sanitize(engine.makeHtml(source), {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ["style", "form"],
  });
  for (const link of body.querySelectorAll("a[href]")) {
    if (!link.getAttribute("href").startsWith("#")) link.removeAttribute("href");
    link.removeAttribute("target");
  }
  let section = document.createElement("section");
  while (body.firstChild) {
    const child = body.firstChild;
    if (/^H[1-6]$/.test(child.nodeName) && section.childElementCount) {
      article.append(section);
      section = document.createElement("section");
    }
    section.append(child);
  }
  article.append(section);
  article.addEventListener("click", event => followDocumentLink(article, event));
  viewport.append(article);

  const pending = new Map();
  for (const node of article.querySelectorAll("[data-preview-work]")) {
    const job = jobs.get(node.dataset.previewWork);
    if (job) pending.set(node, job);
  }
  jobs.clear();

  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.intersectionRatio > 0);
    if (!visible.length) return;
    // Let the ordinary content reach the compositor before loading rich blocks.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (viewport.hidden || !article.isConnected) return;
      for (const { target } of visible) {
        const job = pending.get(target);
        if (!job) continue;
        const bounds = target.getBoundingClientRect();
        const view = viewport.getBoundingClientRect();
        if (bounds.bottom <= view.top || bounds.top >= view.bottom) continue;
        pending.delete(target);
        observer.unobserve(target);
        void renderNode(target, job);
      }
    }));
  }, { root: viewport, threshold: Number.EPSILON });

  function setVisible(visible) {
    observer.disconnect();
    if (visible) {
      for (const node of pending.keys()) observer.observe(node);
    }
  }
  setVisible(!viewport.hidden);
  return { setVisible, dispose: () => observer.disconnect() };
}
