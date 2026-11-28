import { defaultKeymap } from "@codemirror/commands";
import { defaultHighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";

const bridge = window.chrome.webview;
const filename = document.querySelector("#filename");
const status = document.querySelector("#state");
const sourceView = document.querySelector("#editor");
const documentView = document.querySelector("#document-view");
const viewMode = document.querySelector("#view-mode");
const showDocument = document.querySelector("#show-document");
const showSource = document.querySelector("#show-source");
const language = new Compartment();
const sourceUpdate = Annotation.define();
const editorTheme = EditorView.theme({}, { dark: matchMedia("(prefers-color-scheme: dark)").matches });

function editorState(text) {
  return EditorState.create({
    doc: text,
    extensions: [
      editorTheme,
      lineNumbers(),
      EditorView.lineWrapping,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.contentAttributes.of({ tabindex: "0" }),
      EditorState.changeFilter.of(transaction => transaction.annotation(sourceUpdate) === true),
      keymap.of([...searchKeymap, ...defaultKeymap]),
      search({ top: true }),
      syntaxHighlighting(defaultHighlightStyle),
      language.of([]),
    ],
  });
}

const editor = new EditorView({ parent: sourceView, state: editorState("") });
let current;

function setView(showMarkdown) {
  sourceView.hidden = showMarkdown;
  documentView.hidden = !showMarkdown;
  documentView.inert = !showMarkdown;
  current?.renderedDocument?.setVisible(showMarkdown);
  showDocument.setAttribute("aria-pressed", showMarkdown);
  showSource.setAttribute("aria-pressed", !showMarkdown);
  if (showMarkdown) documentView.focus({ preventScroll: true });
  else editor.focus();
}

function resetDocument() {
  current?.renderedDocument?.dispose();
  documentView.replaceChildren();
  documentView.scrollTop = 0;
}

function acknowledgeViewLayout(request) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (current === request) bridge.postMessage(`begun:${request.id}`);
  }));
}

showDocument.addEventListener("click", () => setView(true));
showSource.addEventListener("click", () => setView(false));

async function showMarkdown(request) {
  try {
    const { mountMarkdown } = await import("./markdown.js");
    if (current !== request) return;
    request.renderedDocument = mountMarkdown(documentView, editor.state.doc.toString());
    bridge.postMessage(`markdown:attached:${request.id}`);
    status.textContent = "Read-only";
  } catch {
    if (current !== request) return;
    viewMode.hidden = true;
    setView(false);
    status.textContent = "Document rendering unavailable";
  }
}

async function showLanguage(name, document) {
  const basename = name.toLowerCase();
  const aliases = new Map([[".bashrc", "file.sh"], [".profile", "file.sh"], [".bash_profile", "file.sh"],
    ["config.ru", "file.rb"], [".ts", "file.ts"], [".tsx", "file.tsx"], [".js", "file.js"]]);
  const knownName = aliases.get(basename) ?? basename.replace(/\.(erb|liquid)$/, "");
  const description = LanguageDescription.matchFilename(languages, knownName);
  if (!description) return;
  try {
    const support = await description.load();
    if (current === document) editor.dispatch({ effects: language.reconfigure(support) });
  } catch {
    // The file remains available as plain text if a grammar fails to load.
  }
}

bridge.addEventListener("message", ({ data }) => {
  switch (data.action) {
    case "begin":
      filename.textContent = data.name;
      status.textContent = "Reading file…";
      resetDocument();
      current = {
        id: data.id,
        markdown: /\.(?:md|markdown)$/i.test(data.name),
        prefixEndsInCR: data.text.endsWith("\r"),
        parts: [],
      };
      viewMode.hidden = !current.markdown;
      sourceView.hidden = false;
      editor.setState(editorState(data.text));
      editor.scrollDOM.scrollTop = 0;
      editor.scrollDOM.scrollLeft = 0;
      editor.dispatch({ effects: EditorView.scrollIntoView(0, { y: "start", x: "start" }) });
      setView(current.markdown);
      acknowledgeViewLayout(current);
      void showLanguage(data.name, current);
      break;
    case "append":
      if (current?.id === data.id) current.parts.push(data.text);
      break;
    case "complete": {
      if (current?.id !== data.id) return;
      let tail = current.parts.join("");
      current.parts.length = 0;
      if (current.prefixEndsInCR && tail.startsWith("\n")) tail = tail.slice(1);
      if (tail) editor.dispatch({ changes: { from: editor.state.doc.length, insert: tail }, annotations: sourceUpdate.of(true) });
      if (current.markdown) {
        status.textContent = "Rendering document…";
        void showMarkdown(current);
      } else {
        status.textContent = "Read-only";
      }
      break;
    }
    case "clear":
      resetDocument();
      current = null;
      filename.textContent = "";
      status.textContent = "Read-only";
      documentView.hidden = true;
      documentView.inert = true;
      viewMode.hidden = true;
      sourceView.hidden = false;
      editor.setState(editorState(""));
      break;
  }
});

window.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (current) bridge.postMessage(`close:${current.id}`);
}, true);
bridge.postMessage("ready");
