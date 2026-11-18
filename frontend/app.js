import {
  apiRequest,
  BIBLE_CHAPTER_COUNTS as bibleChapterCounts,
  dateKeyInNewYork,
  getImageUrl,
  totalChapterCount,
  scheduledDateForIndex,
  readingIndexForDate,
  formatCadence,
  normalizeChapterSelections,
} from "./data.js";
import { supabase } from "./supabase-client.js";

// --- Application state, DOM bindings, and shared reference data ---
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
  userEmail: null,
  displayName: null,
  bookPlanOriginal: null,
  selectedBookPlanBooks: [],
  // pending plan to continue from archive
  pendingContinuePlan: null,
};

const elements = {
  navLinks: [...document.querySelectorAll(".nav-link[data-view]")],
  appShell: document.querySelector(".app-shell"),
  libraryView: document.querySelector("#library-view"),
  todayView: document.querySelector("#today-view"),
  statsView: document.querySelector("#stats-view"),
  accountView: document.querySelector("#account-view"),
  libraryGreeting: document.querySelector("#library-greeting"),
  statsRefreshButton: document.querySelector("#stats-refresh-button"),
  statsStatus: document.querySelector("#stats-status"),
  statsSummary: document.querySelector("#stats-summary"),
  statsTestamentProgress: document.querySelector("#stats-testament-progress"),
  statsBookList: document.querySelector("#stats-book-list"),
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
  todayReadingStatus: document.querySelector("#today-reading-status"),
  todayReadingStatusIcon: document.querySelector("#today-reading-status-icon"),
  todayReadingStatusText: document.querySelector("#today-reading-status-text"),
  scheduleDate: document.querySelector("#schedule-date"),
  bookPlanTodayEmpty: document.querySelector("#book-plan-today-empty"),
  bookPlanUpcoming: document.querySelector("#book-plan-upcoming"),
  bookPlanTodayList: document.querySelector("#book-plan-today-list"),
  bookPlanOverdueSection: document.querySelector("#book-plan-overdue-section"),
  bookPlanOverdueList: document.querySelector("#book-plan-overdue-list"),
  quickReadingForm: document.querySelector("#quick-reading-form"),
  quickReadingSelections: document.querySelector("#quick-reading-selections"),
  quickReadingSaveButton: document.querySelector("#quick-reading-save-button"),
  bookPlanProgressLabel: document.querySelector("#book-plan-progress-label"),
  bookPlanProgressPercent: document.querySelector("#book-plan-progress-percent"),
  bookPlanProgressBar: document.querySelector("#book-plan-progress-bar"),
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
  accountForm: document.querySelector("#account-form"),
  accountName: document.querySelector("#account-name"),
  accountEmail: document.querySelector("#account-email"),
  accountMessage: document.querySelector("#account-message"),
  accountSaveButton: document.querySelector("#account-save-button"),
  signoutButton: document.querySelector("#signout-button"),
  taskSettingsButton: document.querySelector("#today-task-settings-button"),
  taskSettings: document.querySelector("#today-task-settings"),
  taskForm: document.querySelector("#today-task-form"),
  taskEditId: document.querySelector("#task-edit-id"),
  taskType: document.querySelector("#task-type"),
  taskTitle: document.querySelector("#task-title"),
  taskDetails: document.querySelector("#task-details"),
  taskCadenceType: document.querySelector("#task-cadence-type"),
  taskInterval: document.querySelector("#task-interval"),
  taskIntervalField: document.querySelector("#task-interval-field"),
  taskWeekdaysField: document.querySelector("#task-weekdays-field"),
  taskStartDate: document.querySelector("#task-start-date"),
  taskPreviewSummary: document.querySelector("#task-preview-summary"),
  taskDaysAll: document.querySelector("#task-days-all"),
  taskDaysWeekdays: document.querySelector("#task-days-weekdays"),
  taskDaysWeekends: document.querySelector("#task-days-weekends"),
  taskSaveButton: document.querySelector("#task-save-button"),
  taskCancelEdit: document.querySelector("#task-cancel-edit"),
  taskSettingsList: document.querySelector("#task-settings-list"),
  todayTaskList: document.querySelector("#today-task-list"),
  todayTasksEmpty: document.querySelector("#today-tasks-empty"),
  bookPlanSettingsButton: document.querySelector("#book-plan-settings-button"),
  bookPlanSettings: document.querySelector("#book-plan-settings"),
  bookPlanForm: document.querySelector("#book-plan-form"),
  bookPlanEditId: document.querySelector("#book-plan-edit-id"),
  bookPlanTitle: document.querySelector("#book-plan-title"),
  bookPlanMode: document.querySelector("#book-plan-mode"),
  bookPlanBooks: document.querySelector("#book-plan-books"),
  bookPlanBooksField: document.querySelector("#book-plan-books-field"),
  bookPlanBookSelect: document.querySelector("#book-plan-book-select"),
  bookPlanAddBookButton: document.querySelector("#book-plan-add-book-button"),
  bookPlanSelectedBooks: document.querySelector("#book-plan-selected-books"),
  bookPlanSelections: document.querySelector("#book-plan-selections"),
  bookPlanSelectionsField: document.querySelector("#book-plan-selections-field"),
  bookPlanChapters: document.querySelector("#book-plan-chapters"),
  bookPlanCadenceType: document.querySelector("#book-plan-cadence-type"),
  bookPlanInterval: document.querySelector("#book-plan-interval"),
  bookPlanIntervalField: document.querySelector("#book-plan-interval-field"),
  bookPlanWeekdaysField: document.querySelector("#book-plan-weekdays-field"),
  bookPlanStartDate: document.querySelector("#book-plan-start-date"),
  bookPlanPartnerEmail: document.querySelector("#book-plan-partner-email"),
  bookPlanPreviewSummary: document.querySelector("#book-plan-preview-summary"),
  bookPlanPreviewFinish: document.querySelector("#book-plan-preview-finish"),
  bookPlanDaysAll: document.querySelector("#book-plan-days-all"),
  bookPlanDaysWeekdays: document.querySelector("#book-plan-days-weekdays"),
  bookPlanDaysWeekends: document.querySelector("#book-plan-days-weekends"),
  bookPlanDate: document.querySelector("#book-plan-date"),
  bookPlanCancel: document.querySelector("#book-plan-cancel"),
  bookPlanSaveButton: document.querySelector("#book-plan-save-button"),
  bookPlanEditWarning: document.querySelector("#book-plan-edit-warning"),
  bookPlanList: document.querySelector("#book-plan-list"),
  bookPlansEmpty: document.querySelector("#book-plans-empty"),
  completedPlansCount: document.querySelector("#completed-plans-count"),
  completedPlansEmpty: document.querySelector("#completed-plans-empty"),
  completedPlansList: document.querySelector("#completed-plans-list"),
  // Continue plan dialog elements
  continuePlanDialog: document.querySelector("#continue-plan-dialog"),
  continuePlanForm: document.querySelector("#continue-plan-form"),
  continuePlanTitle: document.querySelector("#continue-plan-title"),
  continuePlanScope: document.querySelector("#continue-plan-scope"),
  continuePlanDate: document.querySelector("#continue-plan-date"),
  continuePlanSubmit: document.querySelector("#continue-plan-submit"),
  continuePlanClose: document.querySelector("#continue-plan-close"),
  // End of dialog elements
};

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

elements.accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const displayName = elements.accountName.value.trim();
  if (!displayName || displayName.length > 80) {
    elements.accountMessage.textContent = "Enter a name between 1 and 80 characters.";
    return;
  }
  elements.accountSaveButton.disabled = true;
  elements.accountMessage.textContent = "Saving your name…";
  try {
    if (!state.userId) throw new Error("Sign in to update your account name.");
    const { data, error } = await supabase.from("study_user_profiles")
      .upsert({ user_id: state.userId, display_name: displayName }, { onConflict: "user_id" })
      .select("display_name")
      .single();
    if (error) throw error;
    syncAccountProfile(data.display_name, state.userEmail);
    elements.accountMessage.textContent = "Your account name was saved.";
  } catch (error) {
    elements.accountMessage.textContent = `Could not save your name: ${error.message}`;
  } finally {
    elements.accountSaveButton.disabled = false;
  }
});



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
  `\\b(${bibleBookNames.join("|")})(?![a-z])\\s+(\\d{1,3}(?:\\s*[,/]\\s*\\d{1,3}(?!\\s*:))?(?:\\s*:\\s*\\d+(?:\\s*[-–]\\s*\\d+)?)?)`,
  "i",
);
const bibleBookOnlyPattern = new RegExp(`\\b(${bibleBookNames.join("|")})(?![a-z])`, "i");
const bibleReferenceMatcher = new RegExp(bibleReferencePattern.source, "gi");
const bibleBookDisplayNames = new Map([
  ["gen", "Genesis"],
  ["exod", "Exodus"],
  ["ex", "Exodus"],
  ["lev", "Leviticus"],
  ["num", "Numbers"],
  ["deut", "Deuteronomy"],
  ["josh", "Joshua"],
  ["judg", "Judges"],
  ["neh", "Nehemiah"],
  ["psalm", "Psalms"],
  ["ps", "Psalms"],
  ["prov", "Proverbs"],
  ["eccl", "Ecclesiastes"],
  ["isa", "Isaiah"],
  ["is", "Isaiah"],
  ["jer", "Jeremiah"],
  ["lam", "Lamentations"],
  ["ezek", "Ezekiel"],
  ["dan", "Daniel"],
  ["hos", "Hosea"],
  ["mic", "Micah"],
  ["nah", "Nahum"],
  ["hab", "Habakkuk"],
  ["zeph", "Zephaniah"],
  ["hag", "Haggai"],
  ["zech", "Zechariah"],
  ["mat", "Matthew"],
  ["matt", "Matthew"],
  ["mk", "Mark"],
  ["lk", "Luke"],
  ["rom", "Romans"],
  ["jn", "John"],
  ["john", "John"],
  ["gal", "Galatians"],
  ["eph", "Ephesians"],
  ["ephesians", "Ephesians"],
  ["phil", "Philippians"],
  ["col", "Colossians"],
  ["heb", "Hebrews"],
  ["jas", "James"],
  ["phlm", "Philemon"],
  ["rev", "Revelation"],
  ["1 sam", "1 Samuel"],
  ["2 sam", "2 Samuel"],
  ["1 kgs", "1 Kings"],
  ["2 kgs", "2 Kings"],
  ["1 chr", "1 Chronicles"],
  ["2 chr", "2 Chronicles"],
  ["1 cor", "1 Corinthians"],
  ["2 cor", "2 Corinthians"],
  ["1 thess", "1 Thessalonians"],
  ["2 thess", "2 Thessalonians"],
  ["1 tim", "1 Timothy"],
  ["2 tim", "2 Timothy"],
  ["1 pet", "1 Peter"],
  ["2 pet", "2 Peter"],
  ["1 jn", "1 John"],
  ["2 jn", "2 John"],
  ["3 jn", "3 John"],
]);
// --- Shared notifications, folder browser, and library loading ---
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

// --- Bible reference matching and cross-reference navigation ---
function findBibleReference(text) {
  const match = text.match(bibleReferencePattern);
  if (!match) return "";
  const displayName = normalizeBibleBook(match[1]);
  const passageMatch = match[2].match(
    /^(\d{1,3})(?:\s*[,/]\s*(\d{1,3})(?!\s*:))?(?:\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/,
  );
  const chapterCount = bibleChapterCounts.get(displayName.toLowerCase());
  if (!passageMatch || !chapterCount) return "";
  const firstChapter = Number(passageMatch[1]);
  const lastChapter = Number(passageMatch[2] || passageMatch[1]);
  if (firstChapter < 1 || lastChapter < firstChapter || lastChapter > chapterCount) return "";
  const firstVerse = Number(passageMatch[3] || 0);
  const lastVerse = Number(passageMatch[4] || passageMatch[3] || 0);
  if (passageMatch[3] && (firstVerse < 1 || lastVerse < firstVerse)) return "";
  const passage = match[2]
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*/g, ":")
    .replace(/\s*[,/]\s*/g, "-")
    .replace(/\s*([–-])\s*/g, "$1")
    .trim();
  return `${displayName} ${passage}`;
}

function normalizeBibleBook(book) {
  const normalized = book.replace(/\s+/g, " ").replace(/\./g, "").trim();
  return bibleBookDisplayNames.get(normalized.toLowerCase()) || normalized;
}

function findBibleBook(text) {
  const match = text.match(bibleBookOnlyPattern);
  return match ? normalizeBibleBook(match[1]) : "";
}

function activeNoteBibleBook() {
  const reference = state.noteRawContent.match(/^reference:\s*(.+)$/m)?.[1] || "";
  for (const candidate of [reference, state.noteTitle]) {
    const passage = findBibleReference(candidate);
    const book = passage.match(/^(.+?)\s+\d/);
    if (book) return book[1];
    const titleBook = findBibleBook(candidate);
    if (titleBook) return titleBook;
  }
  return "";
}

function findAutomaticReferences(text, noteBook = activeNoteBibleBook()) {
  const matches = [];
  for (const match of text.matchAll(new RegExp(bibleReferenceMatcher.source, "gi"))) {
    const reference = findBibleReference(match[0]);
    if (!reference) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "invalid-bible",
      });
      continue;
    }
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      label: match[0],
      type: "bible",
      target: reference,
    });
  }

  for (const match of text.matchAll(/(?<![\w:])(\d{1,3}\s*:\s*\d+(?:\s*[-–]\s*\d+)?)(?![\d:])/g)) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      label: match[0],
      type: "short-bible",
      target: match[0].replace(/\s+/g, ""),
    });
  }

  const identifiers = new Map();
  for (const note of state.folders.flatMap((folder) => folder.files || [])) {
    const identifier = String(
      note.identifier || note.name.match(/(?<![A-Z0-9])[A-Z]\d{3}(?![A-Z0-9])/i)?.[0] || "",
    ).toUpperCase();
    if (!/^[A-Z]\d{3}$/.test(identifier)) continue;
    identifiers.set(identifier, identifiers.has(identifier) ? null : note);
  }
  for (const [identifier, note] of identifiers) {
    if (!note || note.path === state.activeNotePath) continue;
    const pattern = new RegExp(`(?<![A-Z0-9])(${identifier})(?![A-Z0-9])`, "gi");
    for (const match of text.matchAll(pattern)) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        label: match[0],
        type: "note",
        target: note.path,
      });
    }
  }

  matches.sort((left, right) => left.start - right.start || right.end - left.end);
  let cursor = 0;
  const references = [];
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.type === "invalid-bible") {
      cursor = match.end;
      continue;
    }
    if (match.type === "short-bible") {
      if (!noteBook) continue;
      const reference = findBibleReference(`${noteBook} ${match.target}`);
      if (!reference) continue;
      match.target = reference;
    }
    references.push(match);
    cursor = match.end;
  }
  return references;
}

function resolveBibleReference(note) {
  for (const candidate of [note.reference, note.title, note.content]) {
    if (typeof candidate !== "string") continue;
    const reference = findBibleReference(candidate);
    if (reference) return reference;
  }
  return "";
}

// --- Passage panel and resizable editor panes ---
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

// --- Note search and search-result actions ---
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

// --- Rich-text editor selection and formatting commands ---
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

// --- Markdown parsing, rendering, and editor serialization ---
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
    appendAutomaticReferences(parent, text.slice(cursor, match.index));
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
  appendAutomaticReferences(parent, text.slice(cursor));
}

function createAutomaticReferenceLink(reference) {
  const link = document.createElement("span");
  link.className = "wiki-link";
  link.contentEditable = "false";
  link.textContent = reference.label;
  if (reference.type === "bible" || reference.type === "short-bible") {
    link.classList.add("bible-link");
    link.dataset.bibleref = reference.target;
    link.title = `Look up ${reference.target}`;
    link.addEventListener("click", () => followWikilink(`bible:${reference.target}`));
  } else {
    link.dataset.wikilink = `${reference.target}|${reference.label}`;
    link.title = `Open note ${reference.label}`;
    link.addEventListener("click", () => followWikilink(reference.target));
  }
  return link;
}

function appendAutomaticReferences(parent, text) {
  let cursor = 0;
  for (const reference of findAutomaticReferences(text)) {
    parent.append(document.createTextNode(text.slice(cursor, reference.start)));
    parent.append(createAutomaticReferenceLink(reference));
    cursor = reference.end;
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

function linkCompletedReferenceWhileTyping() {
  const selection = window.getSelection();
  if (
    !state.activeNotePath
    || !selection?.isCollapsed
    || selection.anchorNode?.nodeType !== Node.TEXT_NODE
    || !elements.editor.contains(selection.anchorNode)
  ) {
    return;
  }
  const textNode = selection.anchorNode;
  if (textNode.parentElement?.closest(".wiki-link")) return;
  const value = textNode.nodeValue || "";
  const offset = selection.anchorOffset;
  const before = value.slice(0, offset);
  const boundary = before.match(/[\s,;.!?)]*$/)?.[0] || "";
  if (!boundary) return;
  const candidate = before.slice(0, before.length - boundary.length);
  const reference = [...findAutomaticReferences(candidate)]
    .reverse()
    .find((item) => item.end === candidate.length);
  if (!reference) return;

  const parent = textNode.parentNode;
  if (!parent) return;
  const fragment = document.createDocumentFragment();
  const prefix = value.slice(0, reference.start);
  if (prefix) fragment.append(document.createTextNode(prefix));
  fragment.append(createAutomaticReferenceLink(reference));
  const boundaryNode = document.createTextNode(boundary);
  fragment.append(boundaryNode);
  const suffix = value.slice(offset);
  if (suffix) fragment.append(document.createTextNode(suffix));
  parent.replaceChild(fragment, textNode);

  const caret = document.createRange();
  caret.setStart(boundaryNode, boundary.length);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  state.editorSelection = caret.cloneRange();
}

elements.editor.addEventListener("input", linkCompletedReferenceWhileTyping);

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

// --- Note image attachments: display, upload, replacement, and removal ---
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

// --- Note links, saving, and deletion ---
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
    const result = await requestJson(`/api/note/${encodePath(state.activeNotePath)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    state.noteRawContent = result.content || content;
    state.noteTitle = title;
    elements.noteTitle.value = title;
    elements.noteSource.value = state.noteRawContent;
    renderEditableNote(getEditableMarkdown(state.noteRawContent));
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
  if (!path || !window.confirm(`Delete "${state.noteTitle}"? Images used by another note will stay; unused attached images will be removed from storage.`)) {
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
    showToast("Note deleted. Unused attached images were removed from storage.");
    await loadVault();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.deleteButton.disabled = !state.activeNotePath;
  }
}

// --- Today view: dates, schedules, and recurring tasks ---
function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat(undefined, {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
}

function getSelectedScheduleDate() {
  return (elements.scheduleDate?.value || elements.bookPlanDate?.value || dateKeyInNewYork()).trim();
}

function setSelectedScheduleDate(date) {
  const value = date || dateKeyInNewYork();
  if (elements.scheduleDate) elements.scheduleDate.value = value;
  if (elements.bookPlanDate) elements.bookPlanDate.value = value;
}

async function loadReadingPlan() {
  const dateValue = getSelectedScheduleDate();
  const date = new Date(`${dateValue}T12:00:00Z`);
  elements.todayDate.textContent = new Intl.DateTimeFormat(undefined, {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const todayReadingStatusRequest = loadTodayReadingStatus();
  try {
    await loadRecurringTasks(dateValue);
  } catch (error) {
    elements.todayTaskList.replaceChildren();
    elements.todayTasksEmpty.hidden = false;
    elements.todayTasksEmpty.textContent = `Could not load recurring tasks: ${error.message}`;
  }
  await loadBookReadingPlans(dateValue);
  await todayReadingStatusRequest;
}

async function loadTodayReadingStatus() {
  try {
    const status = await requestJson(`/api/reading-status?date=${dateKeyInNewYork()}`);
    elements.todayReadingStatus.dataset.read = String(status.has_read);
    elements.todayReadingStatus.dataset.error = "false";
    elements.todayReadingStatus.setAttribute("aria-busy", "false");
    elements.todayReadingStatusIcon.textContent = status.has_read ? "✔️" : "❌";
    elements.todayReadingStatusText.textContent = status.has_read
      ? "At least one chapter read today"
      : "No chapter logged today";
  } catch (error) {
    elements.todayReadingStatus.dataset.error = "true";
    elements.todayReadingStatus.setAttribute("aria-busy", "false");
    elements.todayReadingStatusIcon.textContent = "!";
    elements.todayReadingStatusText.textContent = `Could not check today's reading: ${error.message}`;
  }
}

async function loadBookReadingPlans(dateValue = getSelectedScheduleDate()) {
  try {
    const payload = await requestJson(`/api/book-reading-plans?date=${dateValue}`);
    renderCompletedReadingPlans(payload.completed_items || [], "", payload.cancelled_items || []);
    renderBookReadingPlans(
      payload.items || [],
      payload.date || dateValue,
      payload.overdue_readings || [],
      payload.completed_items || [],
    );
  } catch (error) {
    renderCompletedReadingPlans([], `Could not load completed reading plans: ${error.message}`, []);
    elements.bookPlanList.replaceChildren();
    elements.bookPlansEmpty.hidden = false;
    elements.bookPlansEmpty.textContent = `Could not load book reading plans: ${error.message}`;
    elements.bookPlanTodayList.replaceChildren();
    elements.bookPlanTodayEmpty.hidden = false;
    elements.bookPlanTodayEmpty.textContent = `Could not load scheduled readings: ${error.message}`;
    elements.bookPlanUpcoming.hidden = true;
    elements.bookPlanOverdueSection.hidden = true;
    elements.bookPlanOverdueList.replaceChildren();
    elements.bookPlanProgressLabel.textContent = "Reading plan unavailable";
    elements.bookPlanProgressPercent.textContent = "—";
    elements.bookPlanProgressBar.style.width = "0";
  }
}

const taskTypeLabels = {
  "verse-quiz": "Verse Quiz", greek: "Reviewing Greek",
  "church-history": "Church History Study", other: "Other",
};

async function loadRecurringTasks(dateValue = getSelectedScheduleDate()) {
  const payload = await requestJson(`/api/tasks?date=${dateValue}`);
  renderTodayTasks(payload.items || []);
  renderTaskSettings(payload.tasks || []);
}

function renderTodayTasks(items) {
  elements.todayTaskList.replaceChildren();
  elements.todayTasksEmpty.hidden = items.length > 0;
  elements.todayTasksEmpty.textContent = "No recurring tasks scheduled for today. Use Task settings to set up a routine.";
  items.forEach((task, index) => {
    const row = document.createElement("li");
    row.className = "reading-item";
    row.classList.toggle("completed", task.completed);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.id = `task-${index}`;
    checkbox.addEventListener("change", () => toggleTaskCompletion(task.id));
    const label = document.createElement("label");
    label.htmlFor = checkbox.id;
    const kind = document.createElement("span");
    kind.className = "reading-date";
    kind.textContent = taskTypeLabels[task.task_type] || "Task";
    const title = document.createElement("span");
    title.className = "reading-reference";
    title.textContent = task.title;
    label.append(kind, title);
    if (task.details) {
      const details = document.createElement("span");
      details.className = "task-details-text";
      details.textContent = task.details;
      label.append(details);
    }
    row.append(checkbox, label);
    elements.todayTaskList.append(row);
  });
}

function renderTaskSettings(tasks) {
  elements.taskSettingsList.replaceChildren();
  tasks.forEach((task) => {
    const row = document.createElement("li");
    row.className = "task-setting-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.disabled = !task.scheduled;
    checkbox.id = `task-setting-${task.id}`;
    checkbox.setAttribute("aria-label", `Mark ${task.title} complete for ${formatDate(getSelectedScheduleDate())}`);
    if (task.scheduled) checkbox.addEventListener("change", () => toggleTaskCompletion(task.id));
    const description = document.createElement("label");
    description.htmlFor = checkbox.id;
    description.className = "task-setting-description";
    const title = document.createElement("strong");
    title.textContent = `${taskTypeLabels[task.task_type] || "Task"}: ${task.title}`;
    const schedule = document.createElement("span");
    schedule.textContent = `${formatCadence(task)} · Starts ${formatDate(task.start_date)}`;
    description.append(title, schedule);
    row.append(checkbox, description);
    const edit = document.createElement("button");
    edit.type = "button"; edit.className = "button button-quiet"; edit.textContent = "Edit";
    edit.addEventListener("click", () => editRecurringTask(task));
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "button button-danger"; remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteRecurringTask(task));
    row.append(edit, remove);
    elements.taskSettingsList.append(row);
  });
}

function resetTaskForm() {
  elements.taskForm.reset();
  elements.taskEditId.value = "";
  elements.taskCadenceType.value = "interval";
  elements.taskInterval.value = "1";
  elements.taskStartDate.value = getSelectedScheduleDate();
  document.querySelectorAll('input[name="task-day"]').forEach((checkbox) => { checkbox.checked = false; });
  elements.taskSaveButton.textContent = "Add recurring task";
  elements.taskCancelEdit.hidden = true;
  updateTaskCadenceUI();
}

function editRecurringTask(task) {
  elements.taskEditId.value = task.id;
  elements.taskType.value = task.task_type;
  elements.taskTitle.value = task.title;
  elements.taskDetails.value = task.details || "";
  elements.taskCadenceType.value = task.cadence_type || "weekdays";
  elements.taskInterval.value = task.interval_days || 1;
  elements.taskStartDate.value = task.start_date || getSelectedScheduleDate();
  document.querySelectorAll('input[name="task-day"]').forEach((checkbox) => {
    checkbox.checked = Array.isArray(task.weekdays) && task.weekdays.includes(Number(checkbox.value));
  });
  elements.taskSaveButton.textContent = "Save changes";
  elements.taskCancelEdit.hidden = false;
  updateTaskCadenceUI();
  elements.taskTitle.focus();
}

function updateTaskCadenceUI() {
  const isWeekdays = elements.taskCadenceType.value === "weekdays";
  elements.taskIntervalField.hidden = isWeekdays;
  elements.taskInterval.required = !isWeekdays;
  elements.taskWeekdaysField.hidden = !isWeekdays;
  updateTaskPreview();
}

function updateTaskPreview() {
  const cadenceType = elements.taskCadenceType.value;
  const weekdays = [...document.querySelectorAll('input[name="task-day"]:checked')]
    .map((checkbox) => Number(checkbox.value))
    .sort((left, right) => left - right);
  if (cadenceType === "weekdays" && !weekdays.length) {
    elements.taskPreviewSummary.textContent = "Select at least one weekday to preview the task schedule.";
    return;
  }
  const startDate = elements.taskStartDate.value || getSelectedScheduleDate();
  const task = {
    cadence_type: cadenceType,
    interval_days: Math.max(1, Number(elements.taskInterval.value) || 1),
    weekdays,
    start_date: startDate,
  };
  const firstDate = scheduledDateForIndex(task, 0);
  elements.taskPreviewSummary.textContent = `Repeats ${formatCadence(task)}, starting ${formatDate(firstDate)}.`;
}

async function toggleTaskCompletion(id) {
  try {
    await requestJson(`/api/tasks/${id}/toggle?date=${getSelectedScheduleDate()}`, { method: "POST" });
    await loadRecurringTasks();
  } catch (error) { showToast(error.message, true); }
}

async function deleteRecurringTask(task) {
  if (!window.confirm(`Delete recurring task “${task.title}”?`)) return;
  try {
    await requestJson(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (elements.taskEditId.value === task.id) resetTaskForm();
    await loadRecurringTasks();
  } catch (error) { showToast(error.message, true); }
}

async function saveRecurringTask(event) {
  event.preventDefault();
  const id = elements.taskEditId.value;
  const payload = {
    task_type: elements.taskType.value,
    title: elements.taskTitle.value,
    details: elements.taskDetails.value,
    cadence_type: elements.taskCadenceType.value,
    interval_days: Number(elements.taskInterval.value),
    weekdays: [...document.querySelectorAll('input[name="task-day"]:checked')].map((checkbox) => Number(checkbox.value)),
    start_date: elements.taskStartDate.value,
  };
  try {
    await requestJson(id ? `/api/tasks/${id}` : "/api/tasks", {
      method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    resetTaskForm();
    await loadRecurringTasks();
    showToast(id ? "Recurring task updated." : "Recurring task added.");
  } catch (error) { showToast(error.message, true); }
}

// --- Book-plan editing, selected books, and reading checklists ---
function appendBookReadingItem(list, plan, reading, date, overdue = false) {
  const row = document.createElement("li");
  row.className = "reading-item";
  row.classList.toggle("completed", reading.completed);
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = reading.completed;
  checkbox.id = overdue
    ? `book-reading-overdue-${plan.id}-${date}`
    : `book-reading-${plan.id}`;
  checkbox.addEventListener("change", () => toggleBookReadingCompletion(plan.id, date));
  const label = document.createElement("label");
  label.htmlFor = checkbox.id;
  const planTitle = document.createElement("span");
  planTitle.className = "reading-date";
  let titleText = overdue ? `Overdue · ${formatDate(date)} · ${plan.title}` : plan.title;
  if (plan.collaborator_email) {
    titleText += " · 👥 Shared";
  }
  planTitle.textContent = titleText;
  const reference = document.createElement("span");
  reference.className = "reading-reference";
  reference.textContent = reading.reference;
  label.append(planTitle, reference);
  row.append(checkbox, label);
  list.append(row);
}

function renderBookReadingPlans(plans, date, overdueReadings = [], completedPlans = []) {
  renderBookPlanSettings(plans);
  const scheduled = plans.filter((plan) => plan.today_reading);
  const done = scheduled.filter((plan) => plan.today_reading.completed).length;
  const percent = scheduled.length ? Math.round((done / scheduled.length) * 100) : 0;
  const dateLabel = date === dateKeyInNewYork() ? "today" : formatDate(date);
  elements.bookPlanProgressLabel.textContent = plans.length
    ? `${done} of ${scheduled.length} readings complete for ${dateLabel}`
    : completedPlans.length ? "All book reading plans complete" : "No book reading plans";
  elements.bookPlanProgressPercent.textContent = `${percent}%`;
  elements.bookPlanProgressBar.style.width = `${percent}%`;
  elements.bookPlanTodayList.replaceChildren();
  elements.bookPlanTodayEmpty.hidden = scheduled.length > 0;
  elements.bookPlanTodayEmpty.textContent = plans.length
    ? `No readings scheduled for ${formatDate(date)}.`
    : completedPlans.length
      ? "All book reading plans are complete. View them in the Library archive."
      : "No book reading plans yet. Use Book plan settings to create one.";

  const next = plans
    .filter((plan) => plan.next_reading)
    .map((plan) => ({ ...plan.next_reading, title: plan.title }))
    .sort((left, right) => left.date.localeCompare(right.date))[0];
  elements.bookPlanUpcoming.hidden = scheduled.length > 0 || !next;
  elements.bookPlanUpcoming.textContent = next
    ? `Next planned: ${formatDate(next.date)} · ${next.reference} (${next.title})`
    : "";

  scheduled.forEach((plan) => appendBookReadingItem(
    elements.bookPlanTodayList,
    plan,
    plan.today_reading,
    date,
  ));
  elements.bookPlanOverdueList.replaceChildren();
  elements.bookPlanOverdueSection.hidden = overdueReadings.length === 0;
  overdueReadings.forEach((reading) => appendBookReadingItem(
    elements.bookPlanOverdueList,
    { id: reading.plan_id, title: reading.title, collaborator_email: reading.collaborator_email },
    { reference: reading.reference, completed: false },
    reading.scheduled_date,
    true,
  ));
}

function renderBookPlanSettings(plans) {
  elements.bookPlanList.replaceChildren();
  elements.bookPlansEmpty.hidden = plans.length > 0;
  elements.bookPlansEmpty.textContent = "No active book reading plans. Create one here, or view archived plans in the Library.";
  plans.forEach((plan) => {
    const row = document.createElement("li");
    row.className = "book-plan-item";
    const details = document.createElement("div");
    details.className = "book-plan-details";
    const title = document.createElement("h3");
    title.textContent = plan.title;
    const schedule = document.createElement("p");
    schedule.className = "book-plan-schedule";
    const cadence = formatCadence(plan);
    schedule.textContent = `${plan.reading_scope} · ${plan.chapters_per_reading} ${plan.chapters_per_reading === 1 ? "chapter" : "chapters"} ${cadence} · Finishes ${formatDate(plan.finish_date)}`;
    const progress = document.createElement("span");
    progress.className = "book-plan-progress muted";
    progress.textContent = `${plan.completed_readings} of ${plan.total_readings} readings complete`;
    details.append(title, schedule, progress);

    if (plan.collaborator_email) {
      const shared = document.createElement("span");
      shared.className = "plan-badge shared";
      const isPartner = state.userEmail && state.userEmail.toLowerCase() === plan.collaborator_email.toLowerCase();
      shared.textContent = isPartner
        ? `👥 Shared by ${plan.owner_email || "partner"}`
        : `👥 Shared with ${plan.collaborator_email}`;
      details.append(shared);
    }

    const actions = document.createElement("div");
    actions.className = "book-plan-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "button button-quiet";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => editBookReadingPlan(plan));

    const archive = document.createElement("button");
    archive.type = "button";
    archive.className = "button button-quiet button-warning";
    archive.textContent = "Archive";
    archive.title = "Move this plan to the reading plan archive";
    archive.addEventListener("click", () => archiveBookPlan(plan));
    actions.append(edit, archive);
    row.append(details, actions);
    elements.bookPlanList.append(row);
  });
}

function renderCompletedReadingPlans(plans, error = "", cancelledPlans = []) {
  const totalCount = (plans?.length || 0) + (cancelledPlans?.length || 0);
  elements.completedPlansCount.textContent = error ? "Unavailable" : totalCount.toLocaleString();
  elements.completedPlansEmpty.hidden = totalCount > 0 && !error;
  elements.completedPlansEmpty.textContent = error || "No archived reading plans yet.";
  elements.completedPlansList.replaceChildren();

  plans.forEach((plan) => {
    const row = document.createElement("li");
    row.className = "book-plan-item";
    const details = document.createElement("div");
    details.className = "book-plan-details";
    const title = document.createElement("h3");
    title.textContent = plan.title;
    const scope = document.createElement("p");
    scope.className = "book-plan-schedule";
    scope.textContent = plan.reading_scope;
    const progress = document.createElement("p");
    progress.className = "book-plan-progress muted";
    progress.textContent = `Completed all ${plan.total_readings} readings · ${plan.total_chapters} chapters`;
    const badge = document.createElement("span");
    badge.className = "plan-badge completed";
    badge.textContent = "Completed";
    details.append(title, scope, progress, badge);
    const actions = document.createElement("div");
    actions.className = "book-plan-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteBookReadingPlan(plan));
    actions.append(remove);
    row.append(details, actions);
    elements.completedPlansList.append(row);
  });

  (cancelledPlans || []).forEach((plan) => {
    const row = document.createElement("li");
    row.className = "book-plan-item";
    const details = document.createElement("div");
    details.className = "book-plan-details";
    const title = document.createElement("h3");
    title.textContent = plan.title;
    const scope = document.createElement("p");
    scope.className = "book-plan-schedule";
    scope.textContent = plan.reading_scope;
    const progress = document.createElement("p");
    progress.className = "book-plan-progress muted";
    const chaptersRead = Math.min(plan.total_chapters, plan.completed_readings * plan.chapters_per_reading);
    progress.textContent = `Archived · ${plan.completed_readings} of ${plan.total_readings} readings completed (${chaptersRead} chapters)`;
    const badge = document.createElement("span");
    badge.className = "plan-badge cancelled";
    badge.textContent = "Archived";
    details.append(title, scope, progress, badge);

    const actions = document.createElement("div");
    actions.className = "book-plan-actions";
    const continueBtn = document.createElement("button");
    continueBtn.type = "button";
    continueBtn.className = "button button-quiet";
    continueBtn.textContent = "Continue plan";
    continueBtn.title = "Resume this archived plan from where you left off";
    continueBtn.addEventListener("click", () => promptContinueBookPlan(plan));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteBookReadingPlan(plan));
    actions.append(continueBtn, remove);

    row.append(details, actions);
    elements.completedPlansList.append(row);
  });
}

function promptContinueBookPlan(plan) {
  state.pendingContinuePlan = plan;
  if (elements.continuePlanTitle) {
    elements.continuePlanTitle.textContent = plan.title;
  }
  if (elements.continuePlanScope) {
    elements.continuePlanScope.textContent = plan.reading_scope || "";
  }
  if (elements.continuePlanDate) {
    elements.continuePlanDate.value = dateKeyInNewYork();
  }
  if (elements.continuePlanDialog) {
    elements.continuePlanDialog.showModal();
  }
}

if (elements.continuePlanForm) {
  elements.continuePlanForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const plan = state.pendingContinuePlan;
    if (!plan) return;
    const startDate = elements.continuePlanDate?.value || dateKeyInNewYork();
    try {
      if (elements.continuePlanSubmit) elements.continuePlanSubmit.disabled = true;
      await requestJson(`/api/book-reading-plans/${plan.id}/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: startDate }),
      });
      if (elements.continuePlanDialog) elements.continuePlanDialog.close();
      state.pendingContinuePlan = null;
      await loadBookReadingPlans();
      showToast(`"${plan.title}" has been resumed.`);
    } catch (error) {
      showToast(error.message, true);
    } finally {
      if (elements.continuePlanSubmit) elements.continuePlanSubmit.disabled = false;
    }
  });
}

if (elements.continuePlanClose) {
  elements.continuePlanClose.addEventListener("click", () => {
    state.pendingContinuePlan = null;
    if (elements.continuePlanDialog) elements.continuePlanDialog.close();
  });
}

if (elements.continuePlanDialog) {
  elements.continuePlanDialog.addEventListener("cancel", () => {
    state.pendingContinuePlan = null;
  });
}

function formatSelectedChapters(selections) {
  const books = [];
  for (const selection of selections || []) {
    let group = books.at(-1);
    if (group?.book !== selection.book) group = null;
    if (!group) {
      group = { book: selection.book, ranges: [] };
      books.push(group);
    }
    group.ranges.push(`${selection.start}${selection.start === selection.end ? "" : `-${selection.end}`}`);
  }
  return books.map((group) => `${group.book} ${group.ranges.join(", ")}`).join("; ");
}

function populateBookPlanBookSelect() {
  for (const book of bibleChapterCounts.keys()) {
    if (book === "song of songs") continue;
    const option = document.createElement("option");
    option.value = book.replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/\b(Of|The)\b/g, (word) => word.toLowerCase());
    option.textContent = option.value;
    elements.bookPlanBookSelect.append(option);
  }
}

function renderBookPlanSelectedBooks() {
  elements.bookPlanBooks.value = state.selectedBookPlanBooks.join(", ");
  elements.bookPlanSelectedBooks.replaceChildren();
  state.selectedBookPlanBooks.forEach((book) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = book;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-quiet";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${book}`);
    remove.addEventListener("click", () => {
      state.selectedBookPlanBooks = state.selectedBookPlanBooks.filter((selected) => selected !== book);
      renderBookPlanSelectedBooks();
    });
    item.append(name, remove);
    elements.bookPlanSelectedBooks.append(item);
  });
  updateBookPlanPreview();
}

function addBookPlanBook() {
  const book = elements.bookPlanBookSelect.value;
  if (!book) return;
  if (state.selectedBookPlanBooks.includes(book)) {
    showToast(`${book} is already in this plan.`, true);
    return;
  }
  state.selectedBookPlanBooks.push(book);
  elements.bookPlanBookSelect.value = "";
  renderBookPlanSelectedBooks();
}

function updateBookPlanMode() {
  const choosingChapters = elements.bookPlanMode.value === "chapters";
  elements.bookPlanBooksField.hidden = choosingChapters;
  elements.bookPlanSelectionsField.hidden = !choosingChapters;
  elements.bookPlanSelections.required = choosingChapters;
  updateBookPlanPreview();
}

function updateBookPlanCadenceUI() {
  const isWeekdays = elements.bookPlanCadenceType.value === "weekdays";
  elements.bookPlanIntervalField.hidden = isWeekdays;
  elements.bookPlanInterval.required = !isWeekdays;
  elements.bookPlanWeekdaysField.hidden = !isWeekdays;
  updateBookPlanPreview();
}

function updateBookPlanPreview() {
  if (!elements.bookPlanPreviewSummary) return;
  try {
    const mode = elements.bookPlanMode.value;
    let chaptersCount = 0;
    let scopeText = "";
    if (mode === "chapters") {
      const selectionsText = elements.bookPlanSelections.value.trim();
      if (selectionsText) {
        const selections = normalizeChapterSelections(selectionsText);
        chaptersCount = selections.reduce((sum, s) => sum + s.end - s.start + 1, 0);
        scopeText = formatSelectedChapters(selections);
      }
    } else {
      if (state.selectedBookPlanBooks.length) {
        chaptersCount = state.selectedBookPlanBooks.reduce(
          (sum, book) => sum + (bibleChapterCounts.get(book.toLowerCase()) || 0),
          0,
        );
        scopeText = state.selectedBookPlanBooks.join(" + ");
      }
    }

    if (chaptersCount <= 0) {
      elements.bookPlanPreviewSummary.textContent = "Select books or chapters above to preview schedule.";
      elements.bookPlanPreviewFinish.textContent = "";
      return;
    }

    const chaptersPerReading = Math.max(1, Number(elements.bookPlanChapters.value) || 1);
    const totalReadings = Math.ceil(chaptersCount / chaptersPerReading);
    const cadenceType = elements.bookPlanCadenceType.value;
    const weekdays = [...document.querySelectorAll('input[name="book-plan-day"]:checked')]
      .map((cb) => Number(cb.value))
      .sort((a, b) => a - b);
    const intervalDays = Math.max(1, Number(elements.bookPlanInterval.value) || 1);
    const startDate = elements.bookPlanStartDate.value || dateKeyInNewYork();

    if (cadenceType === "weekdays" && !weekdays.length) {
      elements.bookPlanPreviewSummary.textContent = `${chaptersCount} chapters · ${totalReadings} readings · Please select at least one day of the week`;
      elements.bookPlanPreviewFinish.textContent = "";
      return;
    }

    const fakePlan = {
      start_date: startDate,
      cadence_type: cadenceType,
      weekdays,
      interval_days: intervalDays,
    };
    const cadenceText = formatCadence(fakePlan);
    const finishDate = scheduledDateForIndex(fakePlan, totalReadings - 1);

    elements.bookPlanPreviewSummary.textContent = `${scopeText} (${chaptersCount} chapters) · ${totalReadings} ${totalReadings === 1 ? "reading" : "readings"} · ${chaptersPerReading} ${chaptersPerReading === 1 ? "chapter" : "chapters"} ${cadenceText}`;
    elements.bookPlanPreviewFinish.textContent = `Estimated completion: ${formatDate(finishDate)}`;
  } catch {
    elements.bookPlanPreviewSummary.textContent = "Adjust inputs above to update schedule preview.";
    elements.bookPlanPreviewFinish.textContent = "";
  }
}

function bookPlanScheduleValues() {
  const cadenceType = elements.bookPlanCadenceType.value;
  const weekdays = [...document.querySelectorAll('input[name="book-plan-day"]:checked')]
    .map((checkbox) => Number(checkbox.value))
    .sort((a, b) => a - b);
  return {
    reading_mode: elements.bookPlanMode.value,
    books: elements.bookPlanBooks.value.trim(),
    chapter_selections: elements.bookPlanSelections.value.trim(),
    chapters_per_reading: Number(elements.bookPlanChapters.value),
    cadence_type: cadenceType,
    interval_days: cadenceType === "interval" ? Number(elements.bookPlanInterval.value) : 1,
    weekdays: cadenceType === "weekdays" ? weekdays : null,
    collaborator_email: elements.bookPlanPartnerEmail.value.trim().toLowerCase() || null,
    start_date: elements.bookPlanStartDate.value,
  };
}

function editBookReadingPlan(plan) {
  elements.bookPlanSettings.hidden = false;
  elements.bookPlanSettingsButton.setAttribute("aria-expanded", "true");
  elements.bookPlanEditId.value = plan.id;
  elements.bookPlanTitle.value = plan.title;
  elements.bookPlanMode.value = plan.chapter_selections?.length ? "chapters" : "books";
  state.selectedBookPlanBooks = plan.chapter_selections?.length ? [] : [...plan.books];
  renderBookPlanSelectedBooks();
  elements.bookPlanSelections.value = formatSelectedChapters(plan.chapter_selections);
  elements.bookPlanChapters.value = plan.chapters_per_reading;
  elements.bookPlanCadenceType.value = plan.cadence_type || "interval";
  elements.bookPlanInterval.value = plan.interval_days || 1;
  const planWeekdays = Array.isArray(plan.weekdays) ? plan.weekdays : [];
  document.querySelectorAll('input[name="book-plan-day"]').forEach((checkbox) => {
    checkbox.checked = planWeekdays.includes(Number(checkbox.value));
  });
  elements.bookPlanPartnerEmail.value = plan.collaborator_email || "";
  elements.bookPlanStartDate.value = plan.start_date;
  elements.bookPlanSaveButton.textContent = "Save changes";
  elements.bookPlanEditWarning.hidden = false;
  updateBookPlanCadenceUI();
  updateBookPlanMode();
  updateBookPlanPreview();
  state.bookPlanOriginal = bookPlanScheduleValues();
  elements.bookPlanTitle.focus();
}

function resetBookPlanForm() {
  elements.bookPlanForm.reset();
  elements.bookPlanEditId.value = "";
  elements.bookPlanSaveButton.textContent = "Create plan";
  elements.bookPlanEditWarning.hidden = true;
  elements.bookPlanStartDate.value = dateKeyInNewYork();
  elements.bookPlanCadenceType.value = "interval";
  elements.bookPlanInterval.value = "1";
  document.querySelectorAll('input[name="book-plan-day"]').forEach((checkbox) => {
    checkbox.checked = false;
  });
  elements.bookPlanPartnerEmail.value = "";
  state.selectedBookPlanBooks = [];
  renderBookPlanSelectedBooks();
  state.bookPlanOriginal = null;
  updateBookPlanCadenceUI();
  updateBookPlanMode();
  updateBookPlanPreview();
}

async function saveBookReadingPlan(event) {
  event.preventDefault();
  const id = elements.bookPlanEditId.value;
  const schedule = bookPlanScheduleValues();
  const scheduleChanged = id && JSON.stringify(schedule) !== JSON.stringify(state.bookPlanOriginal);
  if (scheduleChanged && !window.confirm("Changing this plan's passages, pace, or start date will reset its completion history. Continue?")) return;
  const payload = {
    title: elements.bookPlanTitle.value,
    ...schedule,
  };
  try {
    await requestJson(id ? `/api/book-reading-plans/${id}` : "/api/book-reading-plans", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    resetBookPlanForm();
    await loadBookReadingPlans();
    showToast(id ? "Book reading plan updated." : "Book reading plan created.");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function toggleBookReadingCompletion(id, date) {
  try {
    const result = await requestJson(`/api/book-reading-plans/${id}/toggle?date=${date}`, { method: "POST" });
    if (result.completed && date < dateKeyInNewYork()) showToast("Overdue reading marked complete.");
    await loadBookReadingPlans();
    await loadTodayReadingStatus();
  } catch (error) {
    showToast(error.message, true);
    await loadBookReadingPlans();
    await loadTodayReadingStatus();
  }
}

async function saveQuickChapterReading(event) {
  event.preventDefault();
  elements.quickReadingSaveButton.disabled = true;
  try {
    const result = await requestJson("/api/chapter-readings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chapter_selections: elements.quickReadingSelections.value,
        read_date: getSelectedScheduleDate(),
      }),
    });
    elements.quickReadingForm.reset();
    showToast(`Logged ${result.reference} for ${formatDate(result.read_date)}.`);
    await loadTodayReadingStatus();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.quickReadingSaveButton.disabled = false;
  }
}

async function archiveBookPlan(plan) {
  if (!window.confirm(`Archive reading plan “${plan.title}”?\n\nIt will be removed from your daily checklist and kept in the reading plan archive.`)) {
    return;
  }
  try {
    await requestJson(`/api/book-reading-plans/${plan.id}/cancel`, { method: "POST" });
    if (elements.bookPlanEditId.value === plan.id) resetBookPlanForm();
    await loadBookReadingPlans();
    showToast("Book reading plan archived.");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function deleteBookReadingPlan(plan) {
  if (!window.confirm(`Permanently delete archived reading plan “${plan.title}” and its completion history?`)) return;
  try {
    await requestJson(`/api/book-reading-plans/${plan.id}`, { method: "DELETE" });
    await loadBookReadingPlans();
    showToast("Archived reading plan deleted.");
  } catch (error) {
    showToast(error.message, true);
  }
}

// --- Reading statistics and scripture coverage ---
function appendStatCard(title, value, description) {
  const card = document.createElement("article");
  card.className = "stats-card panel-card";
  const label = document.createElement("p");
  label.className = "eyebrow";
  label.textContent = title;
  const number = document.createElement("strong");
  number.className = "stats-value";
  number.textContent = value;
  const hint = document.createElement("p");
  hint.className = "muted";
  hint.textContent = description;
  card.append(label, number, hint);
  elements.statsSummary.append(card);
}

function renderReadingStatistics(stats) {
  elements.statsStatus.hidden = true;
  elements.statsSummary.replaceChildren();
  elements.statsTestamentProgress.replaceChildren();
  elements.statsBookList.replaceChildren();
  appendStatCard("NOTES TAKEN", stats.note_count.toLocaleString(), "Notes in your study library");
  appendStatCard("CHAPTERS READ", stats.chapter_reads.toLocaleString(), "Includes rereading the same chapter");
  appendStatCard("BIBLE READ-THROUGHS", stats.bible_read_throughs.toLocaleString(), "How many times you've read the entire Bible");
  appendStatCard(
    "CHAPTERS COVERED",
    `${stats.unique_chapters_read.toLocaleString()} / ${stats.total_chapters.toLocaleString()}`,
    "Distinct chapters logged or checked off in Today",
  );
  appendStatCard("BOOKS COMPLETED", `${stats.completed_books} / ${stats.books.length}`, "Every chapter read at least once");
  appendStatCard("READING DAYS", stats.reading_days.toLocaleString(), "Days with at least one chapter read");
  appendStatCard(
    "CURRENT STREAK",
    `${stats.reading_streak.toLocaleString()} ${stats.reading_streak === 1 ? "day" : "days"}`,
    stats.reading_streak ? "Read at least one chapter each day" : "Read a chapter today to start a streak",
  );

  stats.testaments.forEach((testament) => {
    const row = document.createElement("div");
    row.className = "testament-row";
    const label = document.createElement("div");
    label.className = "testament-label";
    const name = document.createElement("strong");
    name.textContent = testament.name;
    const count = document.createElement("span");
    count.textContent = `${testament.unique_chapters_read} of ${testament.total_chapters} chapters`;
    label.append(name, count);
    const progress = document.createElement("div");
    progress.className = "progress-track";
    const bar = document.createElement("span");
    const percent = testament.total_chapters
      ? Math.round((testament.unique_chapters_read / testament.total_chapters) * 100)
      : 0;
    bar.style.width = `${percent}%`;
    progress.append(bar);
    row.append(label, progress);
    elements.statsTestamentProgress.append(row);
  });

  stats.books.forEach((book) => {
    const details = document.createElement("details");
    details.className = "stats-book";
    const summary = document.createElement("summary");
    const heading = document.createElement("span");
    heading.className = "stats-book-heading";
    const name = document.createElement("strong");
    name.textContent = book.name;
    const count = document.createElement("span");
    count.textContent = `${book.unique_chapters_read} / ${book.total_chapters} chapters · ${book.chapter_reads} reads`;
    heading.append(name, count);
    summary.append(heading);
    const progress = document.createElement("span");
    progress.className = "progress-track stats-book-progress";
    const bar = document.createElement("span");
    bar.style.width = `${Math.round((book.unique_chapters_read / book.total_chapters) * 100)}%`;
    progress.append(bar);
    summary.append(progress);
    const chapters = document.createElement("div");
    chapters.className = "stats-chapters";
    book.chapters.forEach((chapter) => {
      const item = document.createElement("span");
      item.className = "stats-chapter";
      item.classList.toggle("read", chapter.reads > 0);
      item.title = `${book.name} ${chapter.chapter}: read ${chapter.reads} ${chapter.reads === 1 ? "time" : "times"}`;
      item.setAttribute("aria-label", item.title);
      const chapterNumber = document.createElement("span");
      chapterNumber.textContent = chapter.chapter;
      const readCount = document.createElement("small");
      readCount.textContent = chapter.reads ? `${chapter.reads}×` : "—";
      item.append(chapterNumber, readCount);
      chapters.append(item);
    });
    details.append(summary, chapters);
    elements.statsBookList.append(details);
  });
}

async function loadReadingStatistics() {
  elements.statsRefreshButton.disabled = true;
  elements.statsStatus.hidden = false;
  elements.statsStatus.textContent = "Loading your reading stats…";
  try {
    renderReadingStatistics(await requestJson("/api/reading-statistics"));
  } catch (error) {
    elements.statsSummary.replaceChildren();
    elements.statsTestamentProgress.replaceChildren();
    elements.statsBookList.replaceChildren();
    elements.statsStatus.textContent = `Could not load reading stats: ${error.message}`;
  } finally {
    elements.statsRefreshButton.disabled = false;
  }
}

// --- View switching and Bible passage lookup ---
function setActiveView(view) {
  state.activeView = ["today", "stats", "account"].includes(view) ? view : "library";
  const showingToday = state.activeView === "today";
  elements.libraryView.hidden = state.activeView !== "library";
  elements.todayView.hidden = !showingToday;
  elements.statsView.hidden = state.activeView !== "stats";
  elements.accountView.hidden = state.activeView !== "account";
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

async function lookupEsv(event) {
  event.preventDefault();
  const reference = elements.esvQuery.value.trim();
  if (!reference) return;
  await lookupEsvReference(reference);
}

async function lookupEsvReference(reference) {
  const requestId = ++state.passageRequestId;
  const normalizedReference = findBibleReference(reference);
  if (!normalizedReference) {
    elements.esvButton.disabled = false;
    elements.esvResult.hidden = false;
    elements.esvResult.replaceChildren();
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = `Invalid Bible reference: ${reference}.`;
    elements.esvResult.append(message);
    return;
  }
  reference = normalizedReference;
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

// --- UI event wiring ---
elements.passageToggle.addEventListener("click", () => {
  setPassagePanelVisible(elements.passagePanel.hidden);
});
elements.saveButton.addEventListener("click", saveNote);
elements.deleteButton.addEventListener("click", deleteNote);
elements.refreshButton.addEventListener("click", refreshLibrary);
elements.todayRefreshButton.addEventListener("click", loadReadingPlan);
elements.quickReadingForm.addEventListener("submit", saveQuickChapterReading);
setSelectedScheduleDate(dateKeyInNewYork());
elements.bookPlanStartDate.value = dateKeyInNewYork();
elements.taskStartDate.value = dateKeyInNewYork();
updateTaskCadenceUI();
if (elements.scheduleDate) {
  elements.scheduleDate.addEventListener("change", () => {
    setSelectedScheduleDate(elements.scheduleDate.value);
    loadReadingPlan();
  });
}
if (elements.bookPlanDate) {
  elements.bookPlanDate.addEventListener("change", () => {
    setSelectedScheduleDate(elements.bookPlanDate.value);
    loadReadingPlan();
  });
}
elements.bookPlanMode.addEventListener("change", updateBookPlanMode);
populateBookPlanBookSelect();
elements.bookPlanAddBookButton.addEventListener("click", addBookPlanBook);
if (elements.bookPlanCadenceType) {
  elements.bookPlanCadenceType.addEventListener("change", updateBookPlanCadenceUI);
}
if (elements.bookPlanInterval) {
  elements.bookPlanInterval.addEventListener("input", updateBookPlanPreview);
}
if (elements.bookPlanChapters) {
  elements.bookPlanChapters.addEventListener("input", updateBookPlanPreview);
}
if (elements.bookPlanStartDate) {
  elements.bookPlanStartDate.addEventListener("input", updateBookPlanPreview);
}
if (elements.bookPlanSelections) {
  elements.bookPlanSelections.addEventListener("input", updateBookPlanPreview);
}
document.querySelectorAll('input[name="book-plan-day"]').forEach((cb) => {
  cb.addEventListener("change", updateBookPlanPreview);
});
if (elements.bookPlanDaysAll) {
  elements.bookPlanDaysAll.addEventListener("click", () => {
    document.querySelectorAll('input[name="book-plan-day"]').forEach((cb) => { cb.checked = true; });
    updateBookPlanPreview();
  });
}
if (elements.bookPlanDaysWeekdays) {
  elements.bookPlanDaysWeekdays.addEventListener("click", () => {
    document.querySelectorAll('input[name="book-plan-day"]').forEach((cb) => {
      cb.checked = [1, 2, 3, 4, 5].includes(Number(cb.value));
    });
    updateBookPlanPreview();
  });
}
if (elements.bookPlanDaysWeekends) {
  elements.bookPlanDaysWeekends.addEventListener("click", () => {
    document.querySelectorAll('input[name="book-plan-day"]').forEach((cb) => {
      cb.checked = [0, 6].includes(Number(cb.value));
    });
    updateBookPlanPreview();
  });
}
updateBookPlanCadenceUI();
updateBookPlanMode();
updateBookPlanPreview();
elements.bookPlanSettingsButton.addEventListener("click", () => {
  const open = elements.bookPlanSettings.hidden;
  elements.bookPlanSettings.hidden = !open;
  elements.bookPlanSettingsButton.setAttribute("aria-expanded", String(open));
  if (open) elements.bookPlanTitle.focus();
});
elements.bookPlanForm.addEventListener("submit", saveBookReadingPlan);
elements.bookPlanCancel.addEventListener("click", resetBookPlanForm);
elements.taskSettingsButton.addEventListener("click", () => {
  const open = elements.taskSettings.hidden;
  elements.taskSettings.hidden = !open;
  elements.taskSettingsButton.setAttribute("aria-expanded", String(open));
  if (open) loadRecurringTasks().catch((error) => showToast(error.message, true));
});
elements.taskForm.addEventListener("submit", saveRecurringTask);
elements.taskCancelEdit.addEventListener("click", resetTaskForm);
elements.taskCadenceType.addEventListener("change", updateTaskCadenceUI);
elements.taskInterval.addEventListener("input", updateTaskPreview);
elements.taskStartDate.addEventListener("input", updateTaskPreview);
document.querySelectorAll('input[name="task-day"]').forEach((checkbox) => {
  checkbox.addEventListener("change", updateTaskPreview);
});
elements.taskDaysAll.addEventListener("click", () => {
  document.querySelectorAll('input[name="task-day"]').forEach((checkbox) => { checkbox.checked = true; });
  updateTaskPreview();
});
elements.taskDaysWeekdays.addEventListener("click", () => {
  document.querySelectorAll('input[name="task-day"]').forEach((checkbox) => {
    checkbox.checked = [1, 2, 3, 4, 5].includes(Number(checkbox.value));
  });
  updateTaskPreview();
});
elements.taskDaysWeekends.addEventListener("click", () => {
  document.querySelectorAll('input[name="task-day"]').forEach((checkbox) => {
    checkbox.checked = [0, 6].includes(Number(checkbox.value));
  });
  updateTaskPreview();
});
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
    if (link.dataset.view === "stats") loadReadingStatistics();
  });
});
window.addEventListener("popstate", () => {
  const targetView = !window.location.hash || window.location.hash === "#today"
    ? "today"
    : window.location.hash === "#stats" ? "stats"
      : window.location.hash === "#account" ? "account" : "library";
  setActiveView(targetView);
  if (targetView === "today") loadReadingPlan();
  if (targetView === "stats") loadReadingStatistics();
});
elements.esvForm.addEventListener("submit", lookupEsv);
elements.noteSearchForm.addEventListener("submit", searchNotes);
elements.statsRefreshButton.addEventListener("click", loadReadingStatistics);

// --- Initial route and authenticated-session lifecycle ---
const initialView = !window.location.hash || window.location.hash === "#today"
  ? "today"
  : window.location.hash === "#stats" ? "stats"
    : window.location.hash === "#account" ? "account" : "library";
if (!window.location.hash) {
  window.history.replaceState(null, "", "#today");
}
setActiveView(initialView);

async function showSession(session) {
  const authenticated = Boolean(session?.user);
  elements.authPanel.hidden = authenticated;
  elements.appShell.hidden = !authenticated;
  if (!authenticated) {
    clearSignedOutState();
    elements.signedInEmail.textContent = "Supabase";
    elements.signedInEmail.removeAttribute("title");
    return;
  }
  const userChanged = state.userId !== session.user.id;
  if (state.userId && userChanged) clearSignedOutState();
  state.userId = session.user.id;
  state.userEmail = session.user.email || null;
  if (!userChanged) return;
  elements.accountName.value = "";
  elements.accountEmail.textContent = state.userEmail || "Email unavailable";
  elements.accountMessage.textContent = "Loading your account name…";
  elements.signedInEmail.textContent = state.userEmail || "Signed in";
  if (state.userEmail) elements.signedInEmail.title = state.userEmail;
  const requests = [loadVault(), loadReadingPlan(), loadAccountProfile(session.user)];
  if (state.activeView === "stats") requests.push(loadReadingStatistics());
  await Promise.all(requests);
}

async function loadAccountProfile(user) {
  const { data, error } = await supabase.from("study_user_profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (state.userId !== user.id) return;
  if (error) {
    elements.accountMessage.textContent = `Could not load your account name: ${error.message}`;
    return;
  }
  const savedName = data?.display_name
    || (typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "");
  syncAccountProfile(savedName, user.email);
}

function syncAccountProfile(displayName, email) {
  displayName = typeof displayName === "string" ? displayName.trim() : "";
  const savedName = displayName || null;
  const nameChanged = state.displayName !== savedName;
  state.displayName = savedName;
  if (nameChanged || document.activeElement !== elements.accountName) {
    elements.accountName.value = displayName;
  }
  elements.accountEmail.textContent = email || "Email unavailable";
  elements.accountMessage.textContent = displayName
    ? "Your account name is saved."
    : "Choose a name to personalize your account.";
  elements.signedInEmail.textContent = displayName || email || "Signed in";
  if (email) elements.signedInEmail.title = email;
  elements.libraryGreeting.textContent = `Good morning, ${displayName || "reader"}.`;
}

function clearSignedOutState() {
  state.userId = null;
  state.userEmail = null;
  state.displayName = null;
  elements.accountName.value = "";
  elements.accountEmail.textContent = "";
  elements.accountMessage.textContent = "";
  elements.libraryGreeting.textContent = "Good morning, reader.";
  state.selectedBookPlanBooks = [];
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
  elements.bookPlanBooks.value = "";
  elements.bookPlanSelectedBooks.replaceChildren();
  elements.completedPlansCount.textContent = "0";
  elements.completedPlansEmpty.hidden = false;
  elements.completedPlansEmpty.textContent = "Sign in to load completed reading plans.";
  elements.completedPlansList.replaceChildren();
  elements.statsSummary.replaceChildren();
  elements.statsTestamentProgress.replaceChildren();
  elements.statsBookList.replaceChildren();
  elements.statsStatus.hidden = true;
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
