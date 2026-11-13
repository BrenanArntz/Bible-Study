import { apiRequest, getImageUrl } from "./data.js";
import { supabase } from "./supabase-client.js";

const state = {
  folders: [],
  activeFolder: null,
  activeNotePath: null,
  noteIndex: [],
  toastTimer: null,
  activeView: "library",
  noteRawContent: "",
  noteTitle: "",
  noteAttachments: [],
  pendingImageReplacement: null,
  imageActionInProgress: false,
  editorSelection: null,
  passageRequestId: 0,
  paneResize: null,
  heightResize: null,
  userId: null,
};

const elements = {
  navLinks: [...document.querySelectorAll(".nav-link[data-view]")],
  appShell: document.querySelector(".app-shell"),
  libraryView: document.querySelector("#library-view"),
  todayView: document.querySelector("#today-view"),
  folderGrid: document.querySelector("#folder-grid"),
  libraryCount: document.querySelector("#library-count"),
  noteBrowser: document.querySelector("#note-browser"),
  fileList: document.querySelector("#file-list"),
  folderLabel: document.querySelector("#current-folder-label"),
  noteTitle: document.querySelector("#note-title"),
  notePath: document.querySelector("#note-path"),
  editor: document.querySelector("#note-editor"),
  formattingToolbar: document.querySelector("#note-formatting-toolbar"),
  headingFormat: document.querySelector("#note-heading-format"),
  textColor: document.querySelector("#note-text-color"),
  noteReferenceTarget: document.querySelector("#note-reference-target"),
  insertNoteReference: document.querySelector("#insert-note-reference"),
  bibleReferenceInput: document.querySelector("#bible-reference-input"),
  insertBibleReference: document.querySelector("#insert-bible-reference"),
  photosToggle: document.querySelector("#photos-toggle"),
  photosPanel: document.querySelector("#photos-panel"),
  notePhotos: document.querySelector("#note-photos"),
  passageToggle: document.querySelector("#passage-toggle"),
  addNoteImageButton: document.querySelector("#add-note-image-button"),
  noteImageInput: document.querySelector("#note-image-input"),
  passagePanel: document.querySelector("#passage-panel"),
  paneResizer: document.querySelector("#pane-resizer"),
  passageHeightResizer: document.querySelector("#passage-height-resizer"),
  noteHeightResizer: document.querySelector("#note-height-resizer"),
  sourceToggle: document.querySelector("#source-toggle"),
  sourcePanel: document.querySelector("#source-panel"),
  noteSource: document.querySelector("#note-source"),
  saveButton: document.querySelector("#save-button"),
  deleteButton: document.querySelector("#delete-button"),
  refreshButton: document.querySelector("#refresh-button"),
  todayRefreshButton: document.querySelector("#today-refresh-button"),
  todayDate: document.querySelector("#today-date"),
  todayEmpty: document.querySelector("#today-empty"),
  todayUpcoming: document.querySelector("#today-upcoming"),
  todayReadingList: document.querySelector("#today-reading-list"),
  progressLabel: document.querySelector("#today-progress-label"),
  progressPercent: document.querySelector("#today-progress-percent"),
  progressBar: document.querySelector("#today-progress-bar"),
  esvForm: document.querySelector("#esv-form"),
  esvQuery: document.querySelector("#esv-query"),
  esvButton: document.querySelector("#esv-button"),
  esvResult: document.querySelector("#esv-result"),
  toast: document.querySelector("#toast"),
  noteSearchForm: document.querySelector("#note-search-form"),
  searchCount: document.querySelector("#search-count"),
  searchResults: document.querySelector("#search-results"),
  authPanel: document.querySelector("#auth-panel"),
  authForm: document.querySelector("#auth-form"),
  authEmail: document.querySelector("#auth-email"),
  authPassword: document.querySelector("#auth-password"),
  authMessage: document.querySelector("#auth-message"),
  signedInEmail: document.querySelector("#signed-in-email"),
  signoutButton: document.querySelector("#signout-button"),
  importNotesButton: document.querySelector("#import-notes-button"),
  importNotesInput: document.querySelector("#import-notes-input"),
};

const folderSymbols = {
  exegesis: "⌕",
  topics: "◇",
  "church-history": "◷",
  daily: "☼",
};

const bibleBookNames = [
  "Song of Solomon", "Song of Songs", "1 Thessalonians", "2 Thessalonians",
  "1 Corinthians", "2 Corinthians", "1 Chronicles", "2 Chronicles",
  "1 Timothy", "2 Timothy", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
  "1 Peter", "2 Peter", "1 John", "2 John", "3 John",
  "Genesis", "Gen\\.?", "Exodus", "Exod\\.?", "Ex\\.?", "Leviticus", "Lev\\.?",
  "Numbers", "Num\\.?", "Deuteronomy", "Deut\\.?", "Joshua", "Josh\\.?",
  "Judges", "Judg\\.?", "Ruth", "Ezra", "Nehemiah", "Neh\\.?", "Esther", "Job",
  "Psalms?", "Ps\\.?", "Proverbs", "Prov\\.?", "Ecclesiastes", "Eccl\\.?",
  "Isaiah", "Isa\\.?", "Is\\.?", "Jeremiah", "Jer\\.?", "Lamentations", "Lam\\.?",
  "Ezekiel", "Ezek\\.?", "Daniel", "Dan\\.?", "Hosea", "Hos\\.?", "Joel", "Amos",
  "Obadiah", "Obad\\.?", "Jonah", "Micah", "Mic\\.?", "Nahum", "Nah\\.?",
  "Habakkuk", "Hab\\.?", "Zephaniah", "Zeph\\.?", "Haggai", "Hag\\.?",
  "Zechariah", "Zech\\.?", "Malachi", "Mal\\.?", "Matthew", "Matt?\\.?", "Mark",
  "Mk\\.?", "Luke", "Lk\\.?", "John", "Jn\\.?", "Acts", "Romans", "Rom\\.?",
  "Galatians", "Gal\\.?", "Ephesians", "Eph\\.?", "Philippians", "Phil\\.?",
  "Colossians", "Col\\.?", "Hebrews", "Heb\\.?", "James", "Jas\\.?",
  "Philemon", "Phlm\\.?", "Jude", "Revelation", "Rev\\.?",
  "1\\s*Sam\\.?", "2\\s*Sam\\.?", "1\\s*Kgs\\.?", "2\\s*Kgs\\.?",
  "1\\s*Chr\\.?", "2\\s*Chr\\.?", "1\\s*Cor\\.?", "2\\s*Cor\\.?",
  "1\\s*Thess\\.?", "2\\s*Thess\\.?", "1\\s*Tim\\.?", "2\\s*Tim\\.?",
  "1\\s*Pet\\.?", "2\\s*Pet\\.?", "1\\s*Jn\\.?", "2\\s*Jn\\.?", "3\\s*Jn\\.?",
].sort((left, right) => right.length - left.length);
const bibleReferencePattern = new RegExp(
  `\\b(${bibleBookNames.join("|")})(?![a-z])\\s+(\\d{1,3}(?:\\s*:\\s*\\d+(?:\\s*[-–]\\s*\\d+)?)?)`,
  "i",
);
const bibleBookDisplayNames = new Map([
  ["jn", "John"],
  ["john", "John"],
]);

async function requestJson(url, options = {}) {
  return apiRequest(url, options);
}

function showToast(message, isError = false) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 3000);
}

function renderFolderCards() {
  elements.folderGrid.replaceChildren();
  for (const folder of state.folders) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "folder-card";
    card.dataset.folder = folder.key;
    card.classList.toggle("selected", state.activeFolder === folder.key);

    const symbol = document.createElement("span");
    symbol.className = "folder-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = folderSymbols[folder.key] || "◇";
    const title = document.createElement("strong");
    title.textContent = folder.name;
    const count = document.createElement("small");
    count.textContent = `${folder.count} ${folder.count === 1 ? "note" : "notes"}`;
    card.append(symbol, title, count);
    card.addEventListener("click", () => selectFolder(folder.key));
    elements.folderGrid.append(card);
  }
  const total = state.folders.reduce((sum, folder) => sum + folder.count, 0);
  elements.libraryCount.textContent = `${total} ${total === 1 ? "note" : "notes"} across ${state.folders.length} folders`;
}

function selectFolder(key) {
  state.activeFolder = key;
  const folder = state.folders.find((item) => item.key === key);
  if (!folder) return;
  state.noteIndex = folder.files || [];
  elements.folderLabel.textContent = folder.name.toUpperCase();
  renderFolderCards();
  renderFileList(folder);
}

function renderFileList(folder) {
  elements.fileList.replaceChildren();
  const heading = document.createElement("p");
  heading.className = "file-list-heading";
  heading.textContent = folder.name;
  elements.fileList.append(heading);

  if (!folder.files?.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No notes in this folder yet.";
    elements.fileList.append(empty);
    return;
  }

  for (const note of folder.files) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-item";
    button.classList.toggle("active", state.activeNotePath === note.path);
    button.textContent = note.name;
    button.title = note.path;
    button.addEventListener("click", () => openNote(note.path));
    elements.fileList.append(button);
  }
}

function renderVault(payload) {
  state.folders = payload.folders || [];
  updateNoteReferenceOptions();
  renderFolderCards();
  if (!state.activeFolder && state.folders.length) {
    selectFolder("exegesis");
  } else if (state.activeFolder) {
    selectFolder(state.activeFolder);
  }
}

function updateNoteReferenceOptions() {
  const selectedPath = elements.noteReferenceTarget.value;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a note…";
  elements.noteReferenceTarget.replaceChildren(placeholder);

  const notes = state.folders.flatMap((folder) => (
    (folder.files || [])
      .filter((note) => note.path !== state.activeNotePath)
      .map((note) => ({ folder, note }))
  ));
  for (const { folder, note } of notes) {
    const option = document.createElement("option");
    option.value = note.path;
    option.textContent = `${folder.name} · ${note.name.replace(/\.md$/i, "")}`;
    elements.noteReferenceTarget.append(option);
  }
  elements.noteReferenceTarget.value = notes.some(({ note }) => note.path === selectedPath)
    ? selectedPath
    : "";
  elements.noteReferenceTarget.disabled = notes.length === 0;
}

async function loadVault() {
  try {
    renderVault(await requestJson("/api/folders"));
    return true;
  } catch (error) {
    elements.libraryCount.textContent = "Could not load vault";
    showToast(error.message, true);
    return false;
  }
}

async function refreshLibrary() {
  elements.refreshButton.disabled = true;
  elements.refreshButton.textContent = "Refreshing…";
  try {
    if (await loadVault()) showToast("Library refreshed.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.refreshButton.disabled = false;
    elements.refreshButton.textContent = "Refresh library";
  }
}

async function openNote(path) {
  try {
    const note = await requestJson(`/api/note/${encodePath(path)}`);
    state.activeNotePath = note.path;
    state.editorSelection = null;
    elements.formattingToolbar.hidden = false;
    updateNoteReferenceOptions();
    const title = note.title || path.split("/").at(-1).replace(/\.md$/i, "");
    state.noteRawContent = note.content;
    state.noteTitle = title;
    state.noteAttachments = extractNoteAttachments(note.content);
    elements.notePath.textContent = note.path.split("/").slice(0, -1).join(" / ").toUpperCase();
    elements.noteTitle.value = title;
    elements.noteTitle.disabled = false;
    elements.passageToggle.hidden = false;
    elements.addNoteImageButton.hidden = false;
    const reference = resolveBibleReference(note);
    elements.esvQuery.value = reference;
    elements.esvResult.replaceChildren();
    elements.esvResult.hidden = !reference;
    setPassagePanelVisible(true);
    if (reference) {
      lookupEsvReference(reference);
    } else {
      state.passageRequestId += 1;
      elements.esvButton.disabled = false;
    }
    elements.editor.contentEditable = "true";
    elements.editor.setAttribute("aria-disabled", "false");
    elements.saveButton.disabled = false;
    elements.deleteButton.disabled = false;
    elements.deleteButton.hidden = false;
    renderEditableNote(getEditableMarkdown(note.content));
    await renderPhotos();
    elements.photosToggle.hidden = state.noteAttachments.length === 0;
    elements.photosPanel.hidden = true;
    elements.photosToggle.textContent = `Show photos (${state.noteAttachments.length})`;
    elements.sourceToggle.hidden = false;
    elements.sourcePanel.hidden = true;
    elements.sourceToggle.textContent = "Show note source";
    elements.noteSource.value = note.content;
    const folderKey = note.path.split("/")[0];
    const folder = state.folders.find((item) => item.key === folderKey);
    if (folder) {
      state.activeFolder = folderKey;
      elements.folderLabel.textContent = folder.name.toUpperCase();
      renderFolderCards();
      renderFileList(folder);
    }
  } catch (error) {
    showToast(error.message, true);
  }
}

function findBibleReference(text) {
  const match = text.match(bibleReferencePattern);
  if (!match) return "";
  const book = match[1].replace(/\s+/g, " ").replace(/\./g, "").trim();
  const displayName = bibleBookDisplayNames.get(book.toLowerCase()) || book;
  const passage = match[2]
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*/g, ":")
    .replace(/\s*([–-])\s*/g, "$1")
    .trim();
  return `${displayName} ${passage}`;
}

function resolveBibleReference(note) {
  for (const candidate of [note.reference, note.title, note.content]) {
    if (typeof candidate !== "string") continue;
    const reference = findBibleReference(candidate);
    if (reference) return reference;
  }
  return "";
}

function setPassagePanelVisible(visible) {
  elements.passagePanel.hidden = !visible;
  elements.paneResizer.hidden = !visible;
  elements.noteBrowser.classList.toggle("passage-open", visible);
  elements.appShell.classList.toggle("passage-open", visible);
  elements.passageToggle.textContent = visible ? "Hide Bible passage" : "Show Bible passage";
  if (visible) updatePaneResizeValue();
}

function paneWidths() {
  const noteWidth = elements.editor.getBoundingClientRect().width;
  const passageWidth = elements.passagePanel.getBoundingClientRect().width;
  return { noteWidth, totalWidth: noteWidth + passageWidth };
}

function resizePanes(noteWidth) {
  const { totalWidth } = paneWidths();
  const narrowLayout = window.matchMedia("(max-width: 820px)").matches;
  const minNoteWidth = narrowLayout ? 220 : 280;
  const minPassageWidth = narrowLayout ? 240 : 270;
  const maxNoteWidth = Math.max(minNoteWidth, totalWidth - minPassageWidth);
  const nextNoteWidth = Math.max(minNoteWidth, Math.min(noteWidth, maxNoteWidth));
  const nextPassageWidth = Math.max(minPassageWidth, totalWidth - nextNoteWidth);

  elements.noteBrowser.style.setProperty("--note-pane-track", `${nextNoteWidth}fr`);
  elements.noteBrowser.style.setProperty("--passage-pane-track", `${nextPassageWidth}fr`);
  elements.paneResizer.setAttribute(
    "aria-valuenow",
    String(Math.round((nextNoteWidth / (nextNoteWidth + nextPassageWidth)) * 100)),
  );
}

function updatePaneResizeValue() {
  const { noteWidth, totalWidth } = paneWidths();
  if (totalWidth > 0) {
    elements.paneResizer.setAttribute("aria-valuenow", String(Math.round((noteWidth / totalWidth) * 100)));
  }
}

function stopPaneResize(event) {
  if (!state.paneResize || state.paneResize.pointerId !== event.pointerId) return;
  elements.paneResizer.classList.remove("dragging");
  if (elements.paneResizer.hasPointerCapture(event.pointerId)) {
    elements.paneResizer.releasePointerCapture(event.pointerId);
  }
  state.paneResize = null;
}

elements.paneResizer.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const { noteWidth } = paneWidths();
  state.paneResize = { pointerId: event.pointerId, startX: event.clientX, startWidth: noteWidth };
  elements.paneResizer.setPointerCapture(event.pointerId);
  elements.paneResizer.classList.add("dragging");
  event.preventDefault();
});
elements.paneResizer.addEventListener("pointermove", (event) => {
  if (!state.paneResize || state.paneResize.pointerId !== event.pointerId) return;
  resizePanes(state.paneResize.startWidth + event.clientX - state.paneResize.startX);
});
elements.paneResizer.addEventListener("pointerup", stopPaneResize);
elements.paneResizer.addEventListener("pointercancel", stopPaneResize);
elements.paneResizer.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const { noteWidth, totalWidth } = paneWidths();
  const minNoteWidth = window.matchMedia("(max-width: 820px)").matches ? 220 : 280;
  const minPassageWidth = window.matchMedia("(max-width: 820px)").matches ? 240 : 270;
  if (event.key === "Home") {
    resizePanes(minNoteWidth);
  } else if (event.key === "End") {
    resizePanes(totalWidth - minPassageWidth);
  } else {
    resizePanes(noteWidth + (event.key === "ArrowRight" ? 24 : -24));
  }
});

function heightResizeElements(target) {
  return target === "note"
    ? { panel: elements.noteBrowser, handle: elements.noteHeightResizer }
    : { panel: elements.passagePanel, handle: elements.passageHeightResizer };
}

function resizeHeight(target, height) {
  const { panel, handle } = heightResizeElements(target);
  const minHeight = target === "note" ? 480 : 280;
  const maxHeight = target === "note"
    ? Math.max(minHeight, Math.floor(window.innerHeight * 0.9))
    : elements.noteBrowser.clientHeight;
  const nextHeight = Math.max(minHeight, Math.min(height, maxHeight));
  panel.style.height = `${nextHeight}px`;
  if (target === "passage") panel.style.alignSelf = "start";
  handle.setAttribute("aria-valuemax", String(maxHeight));
  handle.setAttribute("aria-valuenow", String(Math.round(nextHeight)));
}

function beginHeightResize(event, target) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const { panel, handle } = heightResizeElements(target);
  state.heightResize = {
    pointerId: event.pointerId,
    target,
    startY: event.clientY,
    startHeight: panel.getBoundingClientRect().height,
  };
  handle.setPointerCapture(event.pointerId);
  handle.classList.add("dragging");
  event.preventDefault();
}

function moveHeightResize(event) {
  const resize = state.heightResize;
  if (!resize || resize.pointerId !== event.pointerId) return;
  resizeHeight(resize.target, resize.startHeight + event.clientY - resize.startY);
}

function stopHeightResize(event) {
  const resize = state.heightResize;
  if (!resize || resize.pointerId !== event.pointerId) return;
  const { handle } = heightResizeElements(resize.target);
  handle.classList.remove("dragging");
  if (handle.hasPointerCapture(event.pointerId)) {
    handle.releasePointerCapture(event.pointerId);
  }
  state.heightResize = null;
}

function handleHeightResizeKey(event, target) {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const { panel } = heightResizeElements(target);
  const minHeight = target === "note" ? 480 : 280;
  const maxHeight = target === "note"
    ? Math.max(minHeight, Math.floor(window.innerHeight * 0.9))
    : elements.noteBrowser.clientHeight;
  const currentHeight = panel.getBoundingClientRect().height;
  const nextHeight = event.key === "Home"
    ? minHeight
    : event.key === "End"
      ? maxHeight
      : currentHeight + (event.key === "ArrowDown" ? 24 : -24);
  resizeHeight(target, nextHeight);
}

for (const [handle, target] of [
  [elements.noteHeightResizer, "note"],
  [elements.passageHeightResizer, "passage"],
]) {
  handle.addEventListener("pointerdown", (event) => beginHeightResize(event, target));
  handle.addEventListener("pointermove", moveHeightResize);
  handle.addEventListener("pointerup", stopHeightResize);
  handle.addEventListener("pointercancel", stopHeightResize);
  handle.addEventListener("keydown", (event) => handleHeightResizeKey(event, target));
}

async function searchNotes(event) {
  event.preventDefault();
  const formData = new FormData(elements.noteSearchForm);
  const params = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    if (value) params.set(key, value);
  }
  elements.searchCount.textContent = "Searching…";
  elements.searchResults.replaceChildren();
  try {
    const payload = await requestJson(`/api/search/notes?${params}`);
    const items = payload.items || [];
    elements.searchCount.textContent = `${payload.total} ${payload.total === 1 ? "note" : "notes"}`;
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No notes match those search terms and filters.";
      elements.searchResults.append(empty);
      return;
    }
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      button.dataset.path = item.path;
      const title = document.createElement("strong");
      title.textContent = item.title;
      const details = document.createElement("span");
      const metadata = [item.category_name, item.identifier, formatDate(item.date)].filter(Boolean);
      details.textContent = metadata.join(" · ");
      const snippet = document.createElement("small");
      snippet.textContent = item.snippet;
      button.append(title, details, snippet);
      button.addEventListener("click", () => openNote(item.path));
      elements.searchResults.append(button);
    }
  } catch (error) {
    elements.searchCount.textContent = "Search failed";
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = error.message;
    elements.searchResults.append(message);
  }
}

function removeDeletedSearchResult(path) {
  const result = [...elements.searchResults.querySelectorAll(".search-result")]
    .find((item) => item.dataset.path === path);
  if (!result) return;

  result.remove();
  const count = Number(elements.searchCount.textContent.match(/^\d+/)?.[0]);
  if (Number.isFinite(count)) {
    const remaining = Math.max(0, count - 1);
    elements.searchCount.textContent = `${remaining} ${remaining === 1 ? "note" : "notes"}`;
  }
  if (!elements.searchResults.querySelector(".search-result")) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No notes match those search terms and filters.";
    elements.searchResults.replaceChildren(empty);
  }
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function rememberEditorSelection() {
  const selection = window.getSelection();
  if (
    selection?.rangeCount
    && elements.editor.contains(selection.anchorNode)
    && elements.editor.contains(selection.focusNode)
  ) {
    state.editorSelection = selection.getRangeAt(0).cloneRange();
  }
}

document.addEventListener("selectionchange", rememberEditorSelection);

function restoreEditorSelection() {
  const selection = window.getSelection();
  if (!selection) return null;
  elements.editor.focus();
  if (state.editorSelection && elements.editor.contains(state.editorSelection.commonAncestorContainer)) {
    selection.removeAllRanges();
    selection.addRange(state.editorSelection);
  }
  return selection.rangeCount
    && elements.editor.contains(selection.anchorNode)
    && elements.editor.contains(selection.focusNode)
    ? selection
    : null;
}

function editorBlockFor(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return element?.closest("p, li, h1, h2, h3, blockquote") || null;
}

function editorBlockAtBoundary(container, offset, isEnd) {
  if (container !== elements.editor) return editorBlockFor(container);
  const child = elements.editor.childNodes[isEnd ? offset - 1 : offset];
  return child instanceof Element && child.matches("p, li, h1, h2, h3, blockquote")
    ? child
    : null;
}

function normalizeInlineRange(range) {
  const startBlock = editorBlockAtBoundary(range.startContainer, range.startOffset, false);
  const endBlock = editorBlockAtBoundary(range.endContainer, range.endOffset, true);
  if (startBlock && endBlock && startBlock !== endBlock) return null;
  const block = startBlock || endBlock;
  if (block && range.startContainer === elements.editor) range.setStart(block, 0);
  if (block && range.endContainer === elements.editor) range.setEnd(block, block.childNodes.length);
  if (range.cloneContents().querySelector("p, li, h1, h2, h3, blockquote, ul, ol, div")) return null;
  return range;
}

function wrapEditorSelection(tagName, color = "") {
  const selection = restoreEditorSelection();
  if (!selection?.rangeCount || selection.isCollapsed) {
    showToast("Select text in the note first.", true);
    return;
  }
  const range = normalizeInlineRange(selection.getRangeAt(0).cloneRange());
  if (!range) {
    showToast("Select text within one paragraph or list item.", true);
    return;
  }
  const wrapper = document.createElement(tagName);
  if (tagName === "span") {
    wrapper.style.color = color;
    wrapper.dataset.textColor = color.toLowerCase();
  }
  wrapper.append(range.extractContents());
  range.insertNode(wrapper);
  const formattedRange = document.createRange();
  formattedRange.selectNodeContents(wrapper);
  selection.removeAllRanges();
  selection.addRange(formattedRange);
  state.editorSelection = formattedRange.cloneRange();
}

function insertEditorReference(target, label, isBibleReference = false) {
  const selection = restoreEditorSelection();
  if (!selection?.rangeCount) {
    showToast("Click in the note where you want to insert the cross-reference.", true);
    return;
  }
  const originalRange = selection.getRangeAt(0);
  const range = originalRange.collapsed
    ? originalRange.cloneRange()
    : normalizeInlineRange(originalRange.cloneRange());
  if (!range) {
    showToast("Select reference text within one paragraph or list item.", true);
    return;
  }
  const selectedLabel = range.toString().replace(/\s+/g, " ").trim();
  const linkLabel = selectedLabel || label;
  const link = document.createElement("span");
  link.className = "wiki-link";
  link.contentEditable = "false";
  link.textContent = linkLabel;
  if (isBibleReference) {
    link.classList.add("bible-link");
    link.dataset.bibleref = target.slice("bible:".length);
    link.title = `Look up ${link.dataset.bibleref}`;
  } else {
    link.dataset.wikilink = `${target}|${linkLabel}`;
    link.title = `Open note ${linkLabel}`;
  }
  link.addEventListener("click", () => followWikilink(target));
  range.deleteContents();
  range.insertNode(link);
  const caret = document.createRange();
  caret.setStartAfter(link);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  state.editorSelection = caret.cloneRange();
}

function applyEditorList(tagName) {
  const selection = restoreEditorSelection();
  if (!selection?.rangeCount) {
    showToast("Click in the note where you want the list.", true);
    return;
  }
  const range = selection.getRangeAt(0);
  const startBlock = editorBlockAtBoundary(range.startContainer, range.startOffset, false);
  const endBlock = editorBlockAtBoundary(range.endContainer, range.endOffset, true);
  if (startBlock && endBlock && startBlock !== endBlock) {
    showToast("Format one paragraph or list item at a time.", true);
    return;
  }
  const block = startBlock || endBlock;
  if (!block) {
    showToast("Click in a paragraph or list item first.", true);
    return;
  }
  if (block.closest("blockquote")) {
    showToast("Lists inside quotations are not supported.", true);
    return;
  }

  const currentList = block.tagName === "LI" ? block.parentElement : null;
  let targetBlock = block;
  if (currentList?.tagName.toLowerCase() === tagName) {
    const paragraphs = [...currentList.children].map((item) => {
      const paragraph = document.createElement("p");
      while (item.firstChild) paragraph.append(item.firstChild);
      return paragraph;
    });
    currentList.replaceWith(...paragraphs);
    targetBlock = paragraphs[0];
  } else if (currentList) {
    const convertedList = document.createElement(tagName);
    while (currentList.firstChild) convertedList.append(currentList.firstChild);
    currentList.replaceWith(convertedList);
  } else {
    const list = document.createElement(tagName);
    const item = document.createElement("li");
    while (block.firstChild) item.append(block.firstChild);
    list.append(item);
    block.replaceWith(list);
    targetBlock = item;
  }

  if (targetBlock) {
    const targetRange = document.createRange();
    targetRange.selectNodeContents(targetBlock);
    selection.removeAllRanges();
    selection.addRange(targetRange);
    state.editorSelection = targetRange.cloneRange();
  }
}

function extractNoteAttachments(content) {
  const attachments = new Map();
  const pattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  for (const match of content.matchAll(pattern)) {
    const upload = match[2].match(/(?:^|\/)_uploads\/([A-Za-z0-9._-]+)$/);
    if (!upload) continue;
    attachments.set(upload[1], {
      filename: upload[1],
      alt: match[1] || "Uploaded handwritten page",
      markdown: match[0],
    });
  }
  return [...attachments.values()];
}

function getEditableMarkdown(content) {
  let markdown = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const imageLinks = [...markdown.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
  const uploadHeadings = [...markdown.matchAll(/^##\s*Image upload\s*[—–-].*$/gm)];
  const markers = [];
  uploadHeadings.forEach((heading, index) => {
    const nextHeading = uploadHeadings[index + 1];
    const image = imageLinks.find((link) => (
      link.index > heading.index && (!nextHeading || link.index < nextHeading.index)
    ));
    const filename = image?.[2].match(/(?:^|\/)_uploads\/([A-Za-z0-9._-]+)$/)?.[1];
    if (filename) {
      markers.push({
        start: heading.index,
        end: heading.index + heading[0].length,
        text: `<!-- image-transcription:${filename} -->`,
      });
    }
  });

  if (imageLinks.length) {
    const firstImage = imageLinks[0];
    const hasUploadHeading = uploadHeadings.some((heading) => heading.index < firstImage.index);
    if (!hasUploadHeading) {
      const filename = firstImage[2].match(/(?:^|\/)_uploads\/([A-Za-z0-9._-]+)$/)?.[1];
      if (filename) {
        const title = markdown.slice(0, firstImage.index).match(/^#\s+.+$/m);
        const insertAt = title ? title.index + title[0].length : 0;
        markers.push({
          start: insertAt,
          end: insertAt,
          text: `\n\n<!-- image-transcription:${filename} -->`,
        });
      }
    }
  }

  markers.sort((left, right) => right.start - left.start);
  for (const marker of markers) {
    markdown = markdown.slice(0, marker.start) + marker.text + markdown.slice(marker.end);
  }

  return markdown
    .replace(/!\[([^\]]*)\]\((?:\.\.\/|\.\/)*_uploads\/[A-Za-z0-9._-]+\)/g, "")
    .replace(/^\s*##\s*Image upload\s*[—–-].*$/gim, "")
    .replace(/^\s*\*\*Reference:\*\*.*$/gim, "")
    .replace(/^\s*WRITING TIME\b.*$/gim, "")
    .replace(/^\s*#\s+.+$/m, "")
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
    .trim();
}

function appendFormattedInline(parent, text) {
  const pattern = /\[\[([^\]]+)\]\]|\*\*([^*]+)\*\*|~~([\s\S]+?)~~|\*([^*\n]+)\*|`([^`\n]+)`|<u>([\s\S]+?)<\/u>|<mark>([\s\S]+?)<\/mark>|<span style="color:\s*(#[0-9a-f]{6});?">([\s\S]+?)<\/span>/gi;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(cursor, match.index)));
    if (match[1]) {
      const [rawTarget, ...rawLabel] = match[1].split("|");
      const target = rawTarget.trim();
      const label = rawLabel.join("|").trim() || target;
      const link = document.createElement("span");
      link.className = "wiki-link";
      link.contentEditable = "false";
      const bibleReference = target.match(/^bible:(.+)$/i)?.[1]?.trim();
      if (bibleReference) {
        link.classList.add("bible-link");
        link.dataset.bibleref = bibleReference;
        link.textContent = label;
        link.title = `Look up ${bibleReference}`;
      } else {
        link.dataset.wikilink = match[1];
        link.textContent = label;
        link.title = `Open note ${label}`;
      }
      link.addEventListener("click", () => followWikilink(target));
      parent.append(link);
    } else if (match[2] || match[3] || match[4] || match[5] || match[6] || match[7] || match[9]) {
      const tagName = match[2] ? "strong"
        : match[3] ? "del"
          : match[4] ? "em"
            : match[5] ? "code"
              : match[6] ? "u"
                : match[7] ? "mark"
                  : "span";
      const node = document.createElement(tagName);
      if (match[9]) {
        node.style.color = match[8];
        node.dataset.textColor = match[8].toLowerCase();
      }
      appendFormattedInline(node, match[2] || match[3] || match[4] || match[5] || match[6] || match[7] || match[9]);
      parent.append(node);
    }
    cursor = match.index + match[0].length;
  }
  parent.append(document.createTextNode(text.slice(cursor)));
}

function renderEditableNote(markdown) {
  elements.editor.replaceChildren();
  const lines = markdown.split(/\r?\n/);
  let paragraph = [];
  let currentList = null;
  let listKind = "";
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const node = document.createElement("p");
    paragraph.forEach((line, index) => {
      appendFormattedInline(node, line);
      if (index < paragraph.length - 1) node.append(document.createElement("br"));
    });
    elements.editor.append(node);
    paragraph = [];
  };

  for (const line of lines) {
    const imageTranscription = line.match(/^<!-- image-transcription:([A-Za-z0-9._-]+) -->$/);
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const quote = line.match(/^>\s?(.*)$/);
    const listMatch = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.+)$/);
    if (imageTranscription) {
      flushParagraph();
      currentList = null;
      const marker = document.createElement("span");
      marker.hidden = true;
      marker.contentEditable = "false";
      marker.dataset.imageTranscription = imageTranscription[1];
      elements.editor.append(marker);
    } else if (!line.trim()) {
      flushParagraph();
      currentList = null;
    } else if (heading) {
      flushParagraph();
      currentList = null;
      const node = document.createElement(`h${heading[1].length}`);
      appendFormattedInline(node, heading[2]);
      elements.editor.append(node);
    } else if (quote) {
      flushParagraph();
      currentList = null;
      const node = document.createElement("p");
      node.className = "preview-quote";
      appendFormattedInline(node, quote[1]);
      const blockquote = document.createElement("blockquote");
      blockquote.append(node);
      elements.editor.append(blockquote);
    } else if (listMatch) {
      flushParagraph();
      const nextListKind = listMatch[2] ? "ol" : "ul";
      if (!currentList || listKind !== nextListKind) {
        currentList = document.createElement(nextListKind);
        listKind = nextListKind;
        elements.editor.append(currentList);
      }
      const item = document.createElement("li");
      appendFormattedInline(item, listMatch[3]);
      currentList.append(item);
    } else {
      currentList = null;
      paragraph.push(line);
    }
  }
  flushParagraph();
}

function serializeInline(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  if (node.tagName === "BR") return "\n";
  if (node.dataset.bibleref) return `[[bible:${node.dataset.bibleref}|${node.textContent || ""}]]`;
  if (node.dataset.wikilink) return `[[${node.dataset.wikilink}]]`;
  const content = [...node.childNodes].map(serializeInline).join("");
  if (node.tagName === "STRONG" || node.tagName === "B") return `**${content}**`;
  if (node.tagName === "EM" || node.tagName === "I") return `*${content}*`;
  if (node.tagName === "U") return `<u>${content}</u>`;
  if (node.tagName === "MARK") return `<mark>${content}</mark>`;
  if (node.tagName === "DEL" || node.tagName === "S" || node.tagName === "STRIKE") return `~~${content}~~`;
  if (node.tagName === "SPAN" && /^#[0-9a-f]{6}$/i.test(node.dataset.textColor || "")) {
    return `<span style="color: ${node.dataset.textColor.toLowerCase()};">${content}</span>`;
  }
  if (node.tagName === "CODE") return `\`${content}\``;
  return content;
}

function serializeBlock(node) {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue || "").trim();
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  if (node.dataset.imageTranscription) {
    return `<!-- image-transcription:${node.dataset.imageTranscription} -->`;
  }
  if (/^H[1-3]$/.test(node.tagName)) {
    return `${"#".repeat(Number(node.tagName[1]))} ${serializeInline(node).trim()}`;
  }
  if (node.tagName === "UL" || node.tagName === "OL") {
    return [...node.children]
      .filter((child) => child.tagName === "LI")
      .map((child, index) => `${node.tagName === "OL" ? `${index + 1}.` : "-"} ${serializeInline(child).trim()}`)
      .join("\n");
  }
  if (node.tagName === "BLOCKQUOTE") {
    return serializeInline(node).split("\n").map((line) => `> ${line}`).join("\n");
  }
  return serializeInline(node).trim();
}

function serializeEditableNote() {
  return [...elements.editor.childNodes]
    .map(serializeBlock)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

async function renderPhotos() {
  const path = state.activeNotePath;
  const items = await Promise.all(state.noteAttachments.map(async (attachment) => {
    const item = document.createElement("div");
    item.className = "note-photo-item";
    const image = document.createElement("img");
    image.className = "note-image";
    image.src = await getImageUrl(attachment.filename);
    image.alt = attachment.alt;
    const actions = document.createElement("div");
    actions.className = "note-photo-actions";
    const replaceButton = document.createElement("button");
    replaceButton.className = "button button-quiet";
    replaceButton.type = "button";
    replaceButton.textContent = "Replace image";
    replaceButton.addEventListener("click", () => {
      state.pendingImageReplacement = attachment.filename;
      elements.noteImageInput.click();
    });
    const deleteButton = document.createElement("button");
    deleteButton.className = "button button-danger";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete image";
    deleteButton.addEventListener("click", () => deleteNoteImage(attachment.filename));
    actions.append(replaceButton, deleteButton);
    item.append(image, actions);
    return item;
  }));
  if (state.activeNotePath === path) elements.notePhotos.replaceChildren(...items);
}

async function reloadNoteAfterImageAction(path) {
  await openNote(path);
  elements.photosPanel.hidden = false;
  elements.photosToggle.textContent = "Hide photos";
}

async function addNoteImage(file) {
  const path = state.activeNotePath;
  if (!path || state.imageActionInProgress) return;
  state.imageActionInProgress = true;
  elements.addNoteImageButton.disabled = true;
  const formData = new FormData();
  formData.append("file", file);
  try {
    await requestJson(`/api/note-images/${encodePath(path)}`, {
      method: "POST",
      body: formData,
    });
    await reloadNoteAfterImageAction(path);
    showToast("Image added to this note.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.imageActionInProgress = false;
    elements.addNoteImageButton.disabled = false;
  }
}

async function replaceNoteImage(file, oldFilename) {
  const path = state.activeNotePath;
  if (!path || state.imageActionInProgress) return;
  const regenerate = window.confirm(
    "Regenerate the transcription associated with this image? The associated text will be replaced; other note text will be kept.",
  );
  state.imageActionInProgress = true;
  elements.addNoteImageButton.disabled = true;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("regenerate_transcription", String(regenerate));
  try {
    const query = new URLSearchParams({ image_name: oldFilename });
    const result = await requestJson(
      `/api/note-images/${encodePath(path)}?${query.toString()}`,
      { method: "PUT", body: formData },
    );
    await reloadNoteAfterImageAction(path);
    showToast(result.transcription_regenerated
      ? "Image and associated transcription updated."
      : "Image updated.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.imageActionInProgress = false;
    elements.addNoteImageButton.disabled = false;
  }
}

async function deleteNoteImage(filename) {
  const path = state.activeNotePath;
  if (!path || state.imageActionInProgress) return;
  if (!window.confirm("Remove this image from the current note? Other notes that share it will keep their copy.")) {
    return;
  }
  state.imageActionInProgress = true;
  elements.addNoteImageButton.disabled = true;
  try {
    const query = new URLSearchParams({ image_name: filename });
    const result = await requestJson(
      `/api/note-images/${encodePath(path)}?${query.toString()}`,
      { method: "DELETE" },
    );
    await reloadNoteAfterImageAction(path);
    showToast(result.file_kept_for_other_notes
      ? "Image removed from this note; it remains in other notes."
      : "Image deleted from this note.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.imageActionInProgress = false;
    elements.addNoteImageButton.disabled = false;
  }
}

elements.addNoteImageButton.addEventListener("click", () => {
  state.pendingImageReplacement = null;
  elements.noteImageInput.click();
});
elements.noteImageInput.addEventListener("change", () => {
  const file = elements.noteImageInput.files?.[0];
  const replacement = state.pendingImageReplacement;
  state.pendingImageReplacement = null;
  elements.noteImageInput.value = "";
  if (!file) return;
  if (replacement) {
    replaceNoteImage(file, replacement);
  } else {
    addNoteImage(file);
  }
});

function updateFrontmatterTitle(frontmatter, title) {
  const titleField = `title: ${JSON.stringify(title)}`;
  if (/^title\s*:/m.test(frontmatter)) {
    return frontmatter.replace(/^title\s*:.*$/m, () => titleField);
  }
  return frontmatter.replace(/^---(\r?\n)/, (_match, newline) => `---${newline}${titleField}${newline}`);
}

function buildSavedNote(title) {
  const frontmatter = state.noteRawContent.match(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/);
  const sections = [];
  if (frontmatter) sections.push(updateFrontmatterTitle(frontmatter[0], title));
  sections.push(`# ${title}`);
  const text = serializeEditableNote();
  if (text) sections.push(text);
  if (state.noteAttachments.length) {
    sections.push(state.noteAttachments.map((attachment) => attachment.markdown).join("\n"));
  }
  return `${sections.join("\n\n").trim()}\n`;
}

elements.photosToggle.addEventListener("click", () => {
  elements.photosPanel.hidden = !elements.photosPanel.hidden;
  elements.photosToggle.textContent = elements.photosPanel.hidden
    ? `Show photos (${state.noteAttachments.length})`
    : "Hide photos";
});
elements.sourceToggle.addEventListener("click", () => {
  elements.sourcePanel.hidden = !elements.sourcePanel.hidden;
  elements.sourceToggle.textContent = elements.sourcePanel.hidden ? "Show note source" : "Hide note source";
});

function followWikilink(label) {
  const bibleReference = label.match(/^bible:(.+)$/i)?.[1];
  if (bibleReference) {
    const reference = findBibleReference(bibleReference);
    if (!reference) {
      showToast(`Invalid Bible cross-reference: ${bibleReference}.`, true);
      return;
    }
    elements.esvQuery.value = reference;
    setPassagePanelVisible(true);
    lookupEsvReference(reference);
    return;
  }
  const normalized = label.toLocaleLowerCase();
  const note = state.folders.flatMap((folder) => folder.files || []).find((item) => {
    const targets = [
      item.path,
      item.name,
      typeof item.filename === "string" ? item.filename.replace(/\.md$/i, "") : "",
    ];
    return targets.some((target) => target?.toLocaleLowerCase() === normalized);
  });
  if (!note) {
    showToast(`No note found for [[${label}]].`, true);
    return;
  }
  const owningFolder = state.folders.find((folder) => folder.files.some((item) => item.path === note.path));
  if (owningFolder && owningFolder.key !== state.activeFolder) {
    state.activeFolder = owningFolder.key;
    elements.folderLabel.textContent = owningFolder.name.toUpperCase();
    renderFolderCards();
    renderFileList(owningFolder);
  }
  openNote(note.path);
}

async function saveNote() {
  if (!state.activeNotePath) return;
  const title = elements.noteTitle.value.trim();
  if (!title) {
    showToast("Note title cannot be empty.", true);
    elements.noteTitle.focus();
    return;
  }
  elements.saveButton.disabled = true;
  try {
    const content = buildSavedNote(title);
    await requestJson(`/api/note/${encodePath(state.activeNotePath)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    state.noteRawContent = content;
    state.noteTitle = title;
    elements.noteTitle.value = title;
    elements.noteSource.value = content;
    showToast("Note saved to your vault.");
    await loadVault();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.saveButton.disabled = false;
  }
}

async function deleteNote() {
  const path = state.activeNotePath;
  if (!path || !window.confirm(`Delete "${state.noteTitle}"? This removes the note from your vault. Attached photos will be kept.`)) {
    return;
  }

  elements.deleteButton.disabled = true;
  try {
    await requestJson(`/api/note/${encodePath(path)}`, { method: "DELETE" });
    removeDeletedSearchResult(path);
    if (state.activeNotePath === path) {
      state.activeNotePath = null;
      state.noteRawContent = "";
      state.noteTitle = "";
      state.noteAttachments = [];
      elements.notePath.textContent = "NO NOTE OPEN";
      elements.noteTitle.value = "Select a note to begin";
      elements.noteTitle.disabled = true;
      elements.editor.contentEditable = "false";
      elements.editor.setAttribute("aria-disabled", "true");
      elements.editor.innerHTML = '<p class="empty-state">Select a note to read or edit…</p>';
      elements.noteSource.value = "";
      elements.notePhotos.replaceChildren();
      elements.passageToggle.hidden = true;
      elements.addNoteImageButton.hidden = true;
      elements.passagePanel.hidden = true;
      elements.noteBrowser.classList.remove("passage-open");
      elements.appShell.classList.remove("passage-open");
      elements.esvQuery.value = "";
      elements.esvResult.replaceChildren();
      elements.esvResult.hidden = true;
      state.passageRequestId += 1;
      elements.photosToggle.hidden = true;
      elements.photosPanel.hidden = true;
      elements.sourceToggle.hidden = true;
      elements.sourcePanel.hidden = true;
      elements.saveButton.disabled = true;
      elements.deleteButton.hidden = true;
    }
    showToast("Note deleted. Attached photos were kept.");
    await loadVault();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.deleteButton.disabled = !state.activeNotePath;
  }
}

function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

async function loadReadingPlan() {
  try {
    const payload = await requestJson("/api/reading-plan");
    renderTodayReadings(payload.items || []);
  } catch (error) {
    elements.todayReadingList.replaceChildren();
    elements.todayEmpty.hidden = false;
    elements.todayEmpty.textContent = `Could not load today's reading plan: ${error.message}`;
    elements.progressLabel.textContent = "Reading plan unavailable";
    elements.progressPercent.textContent = "—";
    elements.progressBar.style.width = "0";
  }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderTodayReadings(items) {
  const today = localDateKey();
  const todayDate = new Date(`${today}T12:00:00`);
  const todayItems = items.filter((item) => String(item.date).slice(0, 10) === today);
  const upcoming = items
    .filter((item) => String(item.date).slice(0, 10) > today)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))[0];

  elements.todayDate.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(todayDate);
  elements.todayEmpty.hidden = todayItems.length > 0;
  elements.todayEmpty.textContent = "Nothing planned for today. Your next scheduled reading is shown below, if you have one.";
  elements.todayUpcoming.hidden = !upcoming || todayItems.length > 0;
  elements.todayUpcoming.textContent = upcoming
    ? `Next planned: ${formatDate(upcoming.date)} — ${formatReading(upcoming.reading) || upcoming.filename}`
    : "";
  elements.todayReadingList.replaceChildren();

  todayItems.forEach((reading, index) => {
    const row = document.createElement("li");
    row.className = "reading-item";
    row.classList.toggle("completed", reading.completed);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = reading.completed;
    checkbox.id = `reading-${index}`;
    checkbox.addEventListener("change", () => toggleReading(reading.filename));
    const label = document.createElement("label");
    label.htmlFor = checkbox.id;
    const date = document.createElement("span");
    date.className = "reading-date";
    date.textContent = formatDate(reading.date);
    const reference = document.createElement("span");
    reference.className = "reading-reference";
    reference.textContent = formatReading(reading.reading) || reading.filename;
    label.append(date, reference);
    row.append(checkbox, label);
    elements.todayReadingList.append(row);
  });
  updateProgress(todayItems);
}

function formatReading(reading) {
  return Array.isArray(reading) ? reading.join(", ") : String(reading || "");
}

function updateProgress(items) {
  const done = items.filter((item) => item.completed).length;
  const percent = items.length ? Math.round((done / items.length) * 100) : 0;
  elements.progressLabel.textContent = `${done} of ${items.length} complete`;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressBar.style.width = `${percent}%`;
}

function setActiveView(view) {
  state.activeView = view === "today" ? "today" : "library";
  const showingToday = state.activeView === "today";
  elements.libraryView.hidden = showingToday;
  elements.todayView.hidden = !showingToday;
  elements.navLinks.forEach((link) => {
    const active = link.dataset.view === state.activeView;
    link.classList.toggle("active", active);
    if (active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

async function toggleReading(filename) {
  try {
    await requestJson(`/api/reading-plan/${encodeURIComponent(filename)}/toggle`, { method: "POST" });
    await loadReadingPlan();
  } catch (error) {
    showToast(error.message, true);
    await loadReadingPlan();
  }
}

async function lookupEsv(event) {
  event.preventDefault();
  const reference = elements.esvQuery.value.trim();
  if (!reference) return;
  await lookupEsvReference(reference);
}

async function lookupEsvReference(reference) {
  const requestId = ++state.passageRequestId;
  elements.esvButton.disabled = true;
  elements.esvResult.hidden = false;
  elements.esvResult.textContent = "Looking up passage…";
  try {
    const payload = await requestJson(`/api/esv?q=${encodeURIComponent(reference)}`);
    if (requestId !== state.passageRequestId) return;
    elements.esvResult.replaceChildren();
    const heading = document.createElement("p");
    heading.className = "esv-reference";
    heading.textContent = payload.reference;
    elements.esvResult.append(heading);
    renderPassageVerses(payload.text);
  } catch (error) {
    if (requestId !== state.passageRequestId) return;
    elements.esvResult.replaceChildren();
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = error.message;
    elements.esvResult.append(message);
  } finally {
    if (requestId === state.passageRequestId) {
      elements.esvButton.disabled = false;
    }
  }
}

function renderPassageVerses(text) {
  const markers = [...text.matchAll(/\[(\d+)\]\s*/g)];
  if (!markers.length) {
    const paragraph = document.createElement("p");
    paragraph.className = "esv-unmarked-text";
    paragraph.textContent = text;
    elements.esvResult.append(paragraph);
    return;
  }

  const introduction = text.slice(0, markers[0].index).trim();
  if (introduction) {
    const paragraph = document.createElement("p");
    paragraph.className = "esv-unmarked-text";
    paragraph.textContent = introduction;
    elements.esvResult.append(paragraph);
  }

  const verses = document.createElement("div");
  verses.className = "esv-verses";
  markers.forEach((marker, index) => {
    const start = marker.index + marker[0].length;
    const end = markers[index + 1]?.index ?? text.length;
    const verse = document.createElement("p");
    verse.className = "esv-verse";
    const number = document.createElement("span");
    number.className = "esv-verse-number";
    number.textContent = marker[1];
    verse.append(number, document.createTextNode(` ${text.slice(start, end).trim()}`));
    verses.append(verse);
  });
  elements.esvResult.append(verses);
}

elements.passageToggle.addEventListener("click", () => {
  setPassagePanelVisible(elements.passagePanel.hidden);
});
elements.saveButton.addEventListener("click", saveNote);
elements.deleteButton.addEventListener("click", deleteNote);
elements.refreshButton.addEventListener("click", refreshLibrary);
elements.todayRefreshButton.addEventListener("click", loadReadingPlan);
elements.formattingToolbar.addEventListener("mousedown", (event) => {
  rememberEditorSelection();
  if (event.target instanceof Element && event.target.closest("button")) event.preventDefault();
});
elements.formattingToolbar.addEventListener("click", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-editor-command], [data-editor-wrap]")
    : null;
  if (!button) return;
  if (button.dataset.editorCommand) {
    if (button.dataset.editorCommand === "insertUnorderedList") {
      applyEditorList("ul");
      return;
    }
    if (button.dataset.editorCommand === "insertOrderedList") {
      applyEditorList("ol");
      return;
    }
    const selection = restoreEditorSelection();
    if (!selection) {
      showToast("Click in the note where you want to format text.", true);
      return;
    }
    document.execCommand(button.dataset.editorCommand, false, null);
    rememberEditorSelection();
  } else if (button.dataset.editorWrap === "underline") {
    wrapEditorSelection("u");
  } else if (button.dataset.editorWrap === "highlight") {
    wrapEditorSelection("mark");
  }
});
elements.headingFormat.addEventListener("change", () => {
  const selection = restoreEditorSelection();
  if (!selection) {
    showToast("Click in the note where you want to format text.", true);
    elements.headingFormat.value = "P";
    return;
  }
  const range = selection.getRangeAt(0);
  const block = editorBlockAtBoundary(range.startContainer, range.startOffset, false)
    || editorBlockAtBoundary(range.endContainer, range.endOffset, true);
  if (block?.closest("blockquote")) {
    showToast("Formatting inside quotations is not supported.", true);
    elements.headingFormat.value = "P";
    return;
  }
  document.execCommand("formatBlock", false, elements.headingFormat.value);
  elements.headingFormat.value = "P";
  rememberEditorSelection();
});
elements.textColor.addEventListener("pointerdown", rememberEditorSelection);
elements.textColor.addEventListener("change", () => {
  wrapEditorSelection("span", elements.textColor.value);
});
elements.insertNoteReference.addEventListener("click", () => {
  const path = elements.noteReferenceTarget.value;
  const note = state.folders
    .flatMap((folder) => folder.files || [])
    .find((item) => item.path === path);
  if (!note) {
    showToast("Choose a note to cross-reference.", true);
    return;
  }
  insertEditorReference(path, note.name.replace(/\.md$/i, ""));
});
elements.insertBibleReference.addEventListener("click", () => {
  const reference = findBibleReference(elements.bibleReferenceInput.value.trim());
  if (!reference) {
    showToast("Enter a Bible passage reference, such as John 3:16.", true);
    return;
  }
  insertEditorReference(`bible:${reference}`, reference, true);
  elements.bibleReferenceInput.value = "";
});
elements.navLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    if (window.location.hash !== link.hash) {
      window.history.pushState(null, "", link.hash);
    }
    setActiveView(link.dataset.view);
    if (link.dataset.view === "today") loadReadingPlan();
  });
});
window.addEventListener("popstate", () => {
  setActiveView(window.location.hash === "#today" ? "today" : "library");
});
elements.esvForm.addEventListener("submit", lookupEsv);
elements.noteSearchForm.addEventListener("submit", searchNotes);

setActiveView(window.location.hash === "#today" ? "today" : "library");

elements.importNotesButton.addEventListener("click", () => elements.importNotesInput.click());
elements.importNotesInput.addEventListener("change", async () => {
  const files = elements.importNotesInput.files;
  if (!files?.length) return;
  if (!window.confirm(`Copy ${files.length} selected files into this Supabase account? Existing notes with the same path will be skipped.`)) {
    elements.importNotesInput.value = "";
    return;
  }
  elements.importNotesButton.disabled = true;
  elements.importNotesButton.textContent = "Importing…";
  try {
    const result = await apiRequest("/api/import-notes", { method: "POST", body: files });
    showToast(`Imported ${result.imported} note(s), ${result.images} image(s); skipped ${result.skipped} existing note(s).`);
    await Promise.all([loadVault(), loadReadingPlan()]);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.importNotesInput.value = "";
    elements.importNotesButton.disabled = false;
    elements.importNotesButton.textContent = "Import local notes";
  }
});

async function showSession(session) {
  const authenticated = Boolean(session?.user);
  elements.authPanel.hidden = authenticated;
  elements.appShell.hidden = !authenticated;
  elements.signoutButton.hidden = !authenticated;
  elements.signedInEmail.textContent = authenticated ? session.user.email || "Signed in" : "Supabase";
  if (!authenticated) {
    clearSignedOutState();
    return;
  }
  if (state.userId && state.userId !== session.user.id) clearSignedOutState();
  if (state.userId === session.user.id) return;
  state.userId = session.user.id;
  await Promise.all([loadVault(), loadReadingPlan()]);
}

function clearSignedOutState() {
  state.userId = null;
  state.editorSelection = null;
  state.folders = [];
  state.activeFolder = null;
  state.activeNotePath = null;
  state.noteIndex = [];
  state.noteRawContent = "";
  state.noteTitle = "";
  state.noteAttachments = [];
  state.pendingImageReplacement = null;
  elements.folderGrid.replaceChildren();
  elements.fileList.innerHTML = '<p class="empty-state">Choose a study folder to browse notes.</p>';
  elements.libraryCount.textContent = "Sign in to load your notes.";
  elements.folderLabel.textContent = "SELECT A FOLDER";
  elements.searchResults.replaceChildren();
  elements.searchCount.textContent = "";
  elements.notePath.textContent = "NO NOTE OPEN";
  elements.noteTitle.value = "Select a note to begin";
  elements.noteTitle.disabled = true;
  elements.editor.replaceChildren();
  elements.editor.contentEditable = "false";
  elements.editor.setAttribute("aria-disabled", "true");
  elements.editor.innerHTML = '<p class="empty-state">Select a note to read or edit…</p>';
  elements.formattingToolbar.hidden = true;
  elements.noteSource.value = "";
  elements.notePhotos.replaceChildren();
  elements.passageToggle.hidden = true;
  elements.addNoteImageButton.hidden = true;
  elements.photosToggle.hidden = true;
  elements.sourceToggle.hidden = true;
  elements.passagePanel.hidden = true;
  elements.photosPanel.hidden = true;
  elements.sourcePanel.hidden = true;
  elements.noteBrowser.classList.remove("passage-open");
  elements.appShell.classList.remove("passage-open");
  elements.esvQuery.value = "";
  elements.esvResult.replaceChildren();
  elements.esvResult.hidden = true;
  state.passageRequestId += 1;
  elements.saveButton.disabled = true;
  elements.deleteButton.disabled = true;
  elements.deleteButton.hidden = true;
}

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  elements.authMessage.textContent = "Signing in…";
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    elements.authForm.reset();
    elements.authMessage.textContent = "Signed in.";
  } catch (error) {
    elements.authMessage.textContent = error.message;
  }
});

elements.signoutButton.addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();
  if (error) showToast(error.message, true);
});

supabase.auth.onAuthStateChange((_event, session) => {
  showSession(session).catch((error) => showToast(error.message, true));
});

const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
if (sessionError) {
  elements.authMessage.textContent = `Could not check your sign-in: ${sessionError.message}`;
} else {
  await showSession(sessionData.session);
}
