import { defaultKeymap } from "@codemirror/commands";
import { defaultHighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";

const bridge = window.chrome.webview;
const filename = document.querySelector("#filename");
const status = document.querySelector("#state");
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

const editor = new EditorView({ parent: document.querySelector("#editor"), state: editorState("") });
let current;

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
      current = { id: data.id, prefixEndsInCR: data.text.endsWith("\r"), parts: [] };
      editor.setState(editorState(data.text));
      editor.scrollDOM.scrollTop = 0;
      editor.scrollDOM.scrollLeft = 0;
      editor.dispatch({ effects: EditorView.scrollIntoView(0, { y: "start", x: "start" }) });
      editor.focus();
      bridge.postMessage(`begun:${data.id}`);
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
      status.textContent = "Read-only";
      break;
    }
    case "clear":
      current = null;
      filename.textContent = "";
      status.textContent = "Read-only";
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
