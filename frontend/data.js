import { supabase } from "./supabase-client.js";

// --- Shared note, image, and Scripture reference configuration ---
const NOTE_CATEGORIES = ["exegesis", "topics", "church-history"];
const FOLDER_NAMES = {
  exegesis: "Exegesis",
  topics: "Topics",
  "church-history": "Church History",
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_LINK = /!\[([^\]]*)\]\(([^)]+)\)/g;
export const BIBLE_CHAPTER_COUNTS = new Map([
  ["genesis", 50], ["exodus", 40], ["leviticus", 27], ["numbers", 36],
  ["deuteronomy", 34], ["joshua", 24], ["judges", 21], ["ruth", 4],
  ["1 samuel", 31], ["2 samuel", 24], ["1 kings", 22], ["2 kings", 25],
  ["1 chronicles", 29], ["2 chronicles", 36], ["ezra", 10], ["nehemiah", 13],
  ["esther", 10], ["job", 42], ["psalms", 150], ["proverbs", 31],
  ["ecclesiastes", 12], ["song of solomon", 8], ["song of songs", 8],
  ["isaiah", 66], ["jeremiah", 52], ["lamentations", 5], ["ezekiel", 48],
  ["daniel", 12], ["hosea", 14], ["joel", 3], ["amos", 9], ["obadiah", 1],
  ["jonah", 4], ["micah", 7], ["nahum", 3], ["habakkuk", 3],
  ["zephaniah", 3], ["haggai", 2], ["zechariah", 14], ["malachi", 4],
  ["matthew", 28], ["mark", 16], ["luke", 24], ["john", 21], ["acts", 28],
  ["romans", 16], ["1 corinthians", 16], ["2 corinthians", 13],
  ["galatians", 6], ["ephesians", 6], ["philippians", 4], ["colossians", 4],
  ["1 thessalonians", 5], ["2 thessalonians", 3], ["1 timothy", 6],
  ["2 timothy", 4], ["titus", 3], ["philemon", 1], ["hebrews", 13],
  ["james", 5], ["1 peter", 5], ["2 peter", 3], ["1 john", 5],
  ["2 john", 1], ["3 john", 1], ["jude", 1], ["revelation", 22],
]);

// --- Authentication, note paths, frontmatter, and core note storage ---
function fail(error, prefix = "Supabase request failed") {
  if (error?.context?.json) {
    return error.context.json().then((payload) => {
      throw new Error(payload.detail || payload.message || `${prefix}: ${error.message}`);
    });
  }
  throw new Error(`${prefix}: ${error?.message || "Unknown error."}`);
}

async function currentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return fail(error, "Could not verify your sign-in");
  if (!data.user) throw new Error("Sign in to access your study notes.");
  return data.user;
}

function safePath(path) {
  const normalized = String(path || "").replace(/\\/g, "/");
  if (
    normalized.startsWith("/")
    || normalized.split("/").some((part) => !part || part === "." || part === "..")
    || !/^(exegesis|topics|church-history|daily)\/.+\.md$/i.test(normalized)
  ) {
    throw new Error("Invalid note path.");
  }
  return normalized;
}

function scalar(value) {
  const text = value.trim();
  if (!text) return "";
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).replace(text.startsWith('"') ? /\\"/g : /''/g, text.startsWith('"') ? '"' : "'");
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1).split(",").map((item) => scalar(item));
    }
  }
  return text;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { metadata: {}, body: content };
  const metadata = {};
  let listKey = null;
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      if (!Array.isArray(metadata[listKey])) metadata[listKey] = [];
      metadata[listKey].push(scalar(item[1]));
      continue;
    }
    const field = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!field) continue;
    listKey = field[2].trim() ? null : field[1];
    metadata[field[1]] = field[2].trim() ? scalar(field[2]) : [];
  }
  return { metadata, body: content.slice(match[0].length) };
}

function normalizeDate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  for (const candidate of [text, ...(text.match(/\b(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\b/g) || [])]) {
    const iso = candidate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) {
      const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
      if (date.toISOString().slice(0, 10) === `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`) {
        return date.toISOString().slice(0, 10);
      }
    }
    const us = candidate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (us) {
      const year = Number(us[3]) < 100 ? 2000 + Number(us[3]) : Number(us[3]);
      const date = new Date(Date.UTC(year, Number(us[1]) - 1, Number(us[2])));
      if (date.getUTCMonth() === Number(us[1]) - 1 && date.getUTCDate() === Number(us[2])) {
        return date.toISOString().slice(0, 10);
      }
    }
  }
  return null;
}

function noteFields(path, content, modifiedAt = new Date().toISOString()) {
  const { metadata, body } = parseFrontmatter(content);
  const category = path.split("/")[0];
  const heading = body.match(/^#\s+(.+?)\s*$/m)?.[1];
  let title = typeof metadata.title === "string" ? metadata.title.trim() : "";
  if (!title || /^\d{6,}$/.test(title) || /^[ET]\d{3}$/i.test(title)) {
    title = heading || path.split("/").at(-1).replace(/\.md$/i, "");
  }
  const idFromText = content.slice(0, 2200).match(/(?<![A-Z0-9])([ET]\d{3})(?!\d)/i)?.[1]?.toUpperCase();
  const idValue = String(metadata.identifier || metadata.id || "").toUpperCase();
  const identifier = /^[ET]\d{3}$/.test(idValue) ? idValue : idFromText || null;
  let date = normalizeDate(metadata.date);
  if (!date) {
    for (const line of body.split(/\r?\n/).slice(0, 20)) {
      date = normalizeDate(line);
      if (date) break;
    }
  }
  return {
    path: safePath(path),
    content,
    title,
    category,
    note_date: date,
    identifier,
    reference: typeof metadata.reference === "string" ? metadata.reference.trim() : "",
    updated_at: modifiedAt,
  };
}

async function allNotes() {
  const { data, error } = await supabase
    .from("study_notes")
    .select("id,user_id,path,content,title,category,note_date,identifier,reference,created_at,updated_at")
    .order("path");
  if (error) return fail(error, "Could not load notes");
  return data || [];
}

async function noteByPath(path) {
  const normalized = safePath(path);
  const { data, error } = await supabase
    .from("study_notes")
    .select("*")
    .eq("path", normalized)
    .maybeSingle();
  if (error) return fail(error, "Could not load note");
  if (!data) throw new Error("Note not found.");
  return data;
}

async function saveNote(path, content) {
  const user = await currentUser();
  const fields = noteFields(path, content);
  const { data, error } = await supabase
    .from("study_notes")
    .update({ ...fields, user_id: user.id })
    .eq("path", fields.path)
    .select("path")
    .maybeSingle();
  if (error) return fail(error, "Could not save note");
  if (!data) throw new Error("Note not found or you do not have permission to edit it.");
  return { path: data.path, status: "saved", content };
}

async function insertNote(path, content) {
  const user = await currentUser();
  const fields = noteFields(path, content);
  const { error } = await supabase
    .from("study_notes")
    .insert({ ...fields, user_id: user.id });
  if (error) return fail(error, "Could not create note");
}

async function storageDelete(paths) {
  if (!paths.length) return;
  const { error } = await supabase.storage.from("study-images").remove(paths);
  if (error) return fail(error, "Could not remove image from storage");
}

// --- Image upload, transcription, and uploaded-note creation ---
function makeImageName(file) {
  const suffix = file.name.match(/\.[a-z0-9]{1,8}$/i)?.[0].toLowerCase() || ".jpg";
  return `${crypto.randomUUID()}${suffix}`;
}

function imageContentType(file) {
  if (file.type.startsWith("image/")) return file.type;
  const suffix = file.name.split(".").at(-1).toLowerCase();
  return {
    bmp: "image/bmp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    tif: "image/tiff",
    tiff: "image/tiff",
    webp: "image/webp",
  }[suffix] || "application/octet-stream";
}

async function uploadImage(file) {
  if (!file || !imageContentType(file).startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Images must be 25 MB or smaller.");
  const user = await currentUser();
  const filename = makeImageName(file);
  const storagePath = `${user.id}/${filename}`;
  const { error } = await supabase.storage.from("study-images").upload(storagePath, file, {
    contentType: imageContentType(file),
    upsert: false,
  });
  if (error) return fail(error, "Could not upload image");
  return { filename, storagePath };
}

export async function getImageUrl(filename) {
  const user = await currentUser();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)) throw new Error("Invalid image name.");
  const { data, error } = await supabase.storage
    .from("study-images")
    .createSignedUrl(`${user.id}/${filename}`, 3600);
  if (error) return fail(error, "Could not load image");
  return data.signedUrl;
}

function relativeImagePath(notePath, filename) {
  const directoryDepth = notePath.split("/").length - 1;
  return `${"../".repeat(directoryDepth)}_uploads/${filename}`;
}

function imageReferences(content) {
  return [...content.matchAll(IMAGE_LINK)]
    .map((match) => match[2].match(/(?:^|\/)_uploads\/([A-Za-z0-9._-]+)$/)?.[1])
    .filter(Boolean);
}

function updateFields(path, content) {
  return noteFields(path, content);
}

async function putContent(path, content) {
  const fields = updateFields(path, content);
  const { data, error } = await supabase
    .from("study_notes")
    .update(fields)
    .eq("path", fields.path)
    .select("path")
    .maybeSingle();
  if (error) return fail(error, "Could not update note");
  if (!data) throw new Error("Note not found or you do not have permission to edit it.");
}

async function transcribeImage(storagePath) {
  const { data, error } = await supabase.functions.invoke("transcribe-image", {
    body: { imagePath: storagePath },
  });
  if (error) {
    if (error.context?.status === 503) return localOcr(storagePath);
    return fail(error, "Image transcription failed");
  }
  if (!Array.isArray(data?.notes)) throw new Error("Transcription returned an invalid response.");
  return data;
}

async function localOcr(storagePath) {
  const { data: image, error } = await supabase.storage.from("study-images").download(storagePath);
  if (error) return fail(error, "Could not load image for browser OCR");
  let tesseract;
  try {
    tesseract = await import("https://esm.sh/tesseract.js@6");
  } catch {
    throw new Error("Browser OCR could not load. Configure Gemini transcription in Supabase or check your connection.");
  }
  const worker = await tesseract.createWorker("eng");
  try {
    const { data } = await worker.recognize(image);
    const markdown = String(data.text || "").trim();
    const identifier = markdown.match(/(?<![A-Z0-9])([ET]\d{3})(?!\d)/i)?.[1]?.toUpperCase() || "";
    const firstLine = markdown.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
    const title = firstLine.split(/\s+/).length <= 8 ? firstLine : "";
    return {
      provider: "browser",
      notes: [{
        transcription: markdown,
        category: identifier.startsWith("E") ? "exegesis" : "topics",
        identifier,
        title,
        date: normalizeDate(firstLine) || "",
        reference: title,
      }],
    };
  } finally {
    await worker.terminate();
  }
}

async function prepareTranscriptionImage(file) {
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot prepare images for transcription. Use a JPEG or PNG image.");
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare this image for transcription.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("Could not convert this image for transcription."));
      }, "image/jpeg", 0.9);
    });
    return new File([blob], "transcription.jpg", { type: "image/jpeg" });
  } catch (error) {
    throw new Error(`Could not prepare ${file.name} for transcription: ${error.message}`);
  } finally {
    bitmap?.close();
  }
}

async function transcribeUploadedImage(file) {
  const transcriptionFile = await prepareTranscriptionImage(file);
  const { storagePath } = await uploadImage(transcriptionFile);
  try {
    return await transcribeImage(storagePath);
  } finally {
    await storageDelete([storagePath]);
  }
}

function makeTitle(identifier, title, reference, fallback) {
  const candidates = [title, reference, fallback]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 200));
  let base = candidates.find((candidate) => {
    const withoutId = identifier
      ? candidate.replace(new RegExp(`^${identifier}\\s*(?:[-:]\\s*)?`, "i"), "").trim()
      : candidate;
    return withoutId && withoutId.toLowerCase() !== identifier.toLowerCase();
  }) || "";
  if (identifier) base = base ? `${identifier} - ${base}` : identifier;
  return base || "Handwritten note";
}

function slug(value) {
  return value.toLocaleLowerCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 80) || "handwritten-note";
}

function createNewContent({ title, identifier, date, reference, markdown, filename, path }) {
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    ...(identifier ? [`identifier: ${identifier}`] : []),
    ...(date ? [`date: ${date}`] : []),
    ...(reference ? [`reference: ${JSON.stringify(reference)}`] : []),
    "---",
  ].join("\n");
  const transcription = markdown.trim() || "No readable text was detected.";
  return `${frontmatter}\n\n# ${title}\n\n## Image upload — ${new Date().toISOString()}\n\n<!-- image-transcription:${filename} -->\n\n${transcription}\n\n![Uploaded handwritten page](${relativeImagePath(path, filename)})\n`;
}

async function appendUpload(path, content, filename, markdown) {
  const addition = [
    "",
    `## Image upload — ${new Date().toISOString()}`,
    "",
    `<!-- image-transcription:${filename} -->`,
    "",
    markdown.trim() || "No readable text was detected.",
    "",
    `![Uploaded handwritten page](${relativeImagePath(path, filename)})`,
  ].join("\n");
  await putContent(path, `${content.trimEnd()}\n\n${addition}\n`);
}

async function createFromUpload(file, targetPath, continuationPath) {
  const { filename, storagePath } = await uploadImage(file);
  let writeStarted = false;
  try {
    const transcription = await transcribeUploadedImage(file);
    const segments = transcription.notes.length ? transcription.notes : [{
      transcription: "",
      category: "topics",
      identifier: "",
      title: "",
      date: "",
      reference: "",
    }];
    const existing = await allNotes();
    const notesByPath = new Map(existing.map((note) => [note.path, note]));
    const grouped = new Map();
    for (const segment of segments) {
      const markdown = typeof segment.transcription === "string" ? segment.transcription.trim() : "";
      const suppliedIdentifier = String(segment.identifier || "");
      const textIdentifier = markdown.match(/(?<![A-Z0-9])([ET]\d{3})(?!\d)/i)?.[1] || "";
      const identifier = /^[ET]\d{3}$/i.test(suppliedIdentifier)
        ? suppliedIdentifier.toUpperCase()
        : textIdentifier.toUpperCase();
      const category = identifier.startsWith("E")
        ? "exegesis"
        : identifier.startsWith("T")
          ? "topics"
          : NOTE_CATEGORIES.includes(segment.category)
            ? segment.category
            : "topics";
      const title = makeTitle(identifier, segment.title, segment.reference, file.name.replace(/\.[^.]+$/, ""));
      let path = targetPath;
      if (!path && identifier) {
        path = existing.find((note) => note.category === category && note.identifier === identifier)?.path
          || [...grouped.values()].find((note) => note.category === category && note.identifier === identifier)?.path;
      }
      if (!path && continuationPath && category === "exegesis" && segments.length === 1) {
        path = continuationPath;
      }
      if (!path) {
        path = `${category}/${slug(title)}.md`;
        let suffix = 2;
        while (notesByPath.has(path) || grouped.has(path)) {
          path = `${category}/${slug(title)}-${suffix++}.md`;
        }
      }
      path = safePath(path);
      const entry = grouped.get(path) || {
        path,
        category: path.split("/")[0],
        title: notesByPath.get(path)?.title || title,
        identifier: identifier || notesByPath.get(path)?.identifier,
        reference: segment.reference || notesByPath.get(path)?.reference || "",
        date: normalizeDate(segment.date),
        markdown: [],
      };
      if (markdown && !entry.markdown.includes(markdown)) entry.markdown.push(markdown);
      grouped.set(path, entry);
    }

    const changedPaths = [];
    for (const item of grouped.values()) {
      const markdown = item.markdown.join("\n\n");
      const current = notesByPath.get(item.path);
      writeStarted = true;
      if (current) {
        await appendUpload(item.path, current.content, filename, markdown);
      } else {
        const content = createNewContent({ ...item, markdown, filename });
        await insertNote(item.path, content);
      }
      changedPaths.push(item.path);
    }
    return {
      original_filename: file.name,
      note_paths: changedPaths,
      note_path: changedPaths[0],
      transcription_available: segments.some((segment) => String(segment.transcription || "").trim()),
      transcription_provider: transcription.provider || "browser",
    };
  } catch (error) {
    if (!writeStarted) await storageDelete([storagePath]);
    else throw new Error(`${error.message} A note may already reference the image, so it was kept in storage.`);
    throw error;
  }
}

async function uploadBatch(formData) {
  const files = formData.getAll("files").filter((file) => file instanceof File);
  const targetPath = formData.get("target_note") ? safePath(formData.get("target_note")) : null;
  if (!files.length) throw new Error("Choose at least one image.");
  if (files.length > 20) throw new Error("Upload 20 images or fewer at a time.");
  if (targetPath) await noteByPath(targetPath);
  const items = [];
  let continuationPath = null;
  for (const file of files) {
    const result = await createFromUpload(file, targetPath, continuationPath);
    items.push(result);
    if (!targetPath) {
      continuationPath = result.note_paths.find((path) => path.startsWith("exegesis/")) || continuationPath;
    }
  }
  return { items };
}

// --- Library folder contents and note search ---
async function listFolders() {
  const notes = await allNotes();
  return {
    folders: NOTE_CATEGORIES.map((key) => {
      const files = notes
        .filter((note) => note.category === key)
        .map((note) => ({ name: note.title, filename: note.path.split("/").at(-1), path: note.path, date: note.note_date, identifier: note.identifier }));
      return { key, name: FOLDER_NAMES[key], count: files.length, files };
    }),
  };
}

function searchNotes(params) {
  return allNotes().then((notes) => {
    const query = (params.get("q") || "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const category = params.get("category") || "all";
    const idType = params.get("id_type") || "all";
    const start = normalizeDate(params.get("date_from"));
    const end = normalizeDate(params.get("date_to"));
    if (params.get("date_from") && !start) throw new Error("Enter a valid start date.");
    if (params.get("date_to") && !end) throw new Error("Enter a valid end date.");
    if (start && end && start > end) throw new Error("Start date must not be after end date.");
    const filtered = notes.filter((note) => {
      if (!NOTE_CATEGORIES.includes(note.category)) return false;
      if (category !== "all" && note.category !== category) return false;
      if (idType === "E" && !note.identifier?.startsWith("E")) return false;
      if (idType === "T" && !note.identifier?.startsWith("T")) return false;
      if (idType === "none" && note.identifier) return false;
      if (start && (!note.note_date || note.note_date < start)) return false;
      if (end && (!note.note_date || note.note_date > end)) return false;
      const searchable = `${note.title} ${note.category} ${note.note_date || ""} ${note.identifier || ""} ${note.reference || ""} ${note.content}`.toLocaleLowerCase();
      return query.every((term) => searchable.includes(term));
    });
    const sortBy = params.get("sort_by") || "title";
    const descending = params.get("order") === "desc";
    const key = {
      title: (note) => note.title.toLocaleLowerCase(),
      date: (note) => note.note_date || "",
      category: (note) => FOLDER_NAMES[note.category].toLocaleLowerCase(),
      modified: (note) => note.updated_at || "",
    }[sortBy] || ((note) => note.title.toLocaleLowerCase());
    filtered.sort((left, right) => key(left).localeCompare(key(right)) * (descending ? -1 : 1));
    return {
      total: filtered.length,
      items: filtered.map((note) => {
        const body = parseFrontmatter(note.content).body;
        const lines = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^#{1,2}\s/.test(line));
        const snippet = lines.find((line) => query.some((term) => line.toLocaleLowerCase().includes(term))) || lines[0] || "";
        return {
          path: note.path,
          title: note.title,
          category: note.category,
          category_name: FOLDER_NAMES[note.category],
          date: note.note_date,
          identifier: note.identifier,
          reference: note.reference,
          modified_at: note.updated_at,
          snippet: snippet.slice(0, 180),
        };
      }),
    };
  });
}

// --- Reading plan validation, chapter parsing, and calendar helpers ---
const TASK_TYPES = ["personal-reading", "reading-with-haley", "verse-quiz", "greek", "church-history", "other"];
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

function validDateKey(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function dateDayNumber(date) {
  return Date.parse(`${date}T00:00:00Z`) / 86400000;
}

function dateFromDayNumber(dayNumber) {
  return new Date(dayNumber * 86400000).toISOString().slice(0, 10);
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function canonicalBookName(value) {
  const canonical = [...BIBLE_CHAPTER_COUNTS.keys()].find((name) => name.toLowerCase() === value.trim().toLowerCase());
  if (!canonical) throw new Error(`Unknown Bible book: ${value}. Use full book names.`);
  return canonical.replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/\b(Of|The)\b/g, (word) => word.toLowerCase());
}

function normalizeChapterSelections(value) {
  const groups = String(value || "").split(";").map((group) => group.trim()).filter(Boolean);
  if (!groups.length) throw new Error("Enter chapter selections, such as Genesis 4, 7-9; Exodus 2.");
  const selections = [];
  const selectedChapters = new Set();
  for (const group of groups) {
    const match = group.match(/^(.+?)\s+(\d+(?:\s*[-–—]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–—]\s*\d+)?)*)$/);
    if (!match) throw new Error(`Could not read chapter selection: ${group}. Separate books with semicolons.`);
    const book = canonicalBookName(match[1]);
    const chapterCount = BIBLE_CHAPTER_COUNTS.get(book.toLowerCase());
    for (const selection of match[2].split(",")) {
      const range = selection.trim().match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
      const start = Number(range[1]);
      const end = Number(range[2] || start);
      if (start < 1 || end < start || end > chapterCount) {
        throw new Error(`${book} has chapters 1–${chapterCount}; check the selection “${selection.trim()}”.`);
      }
      for (let chapter = start; chapter <= end; chapter += 1) {
        const key = `${book.toLowerCase()}:${chapter}`;
        if (selectedChapters.has(key)) throw new Error(`${book} ${chapter} is selected more than once.`);
        selectedChapters.add(key);
      }
      selections.push({ book, start, end });
    }
  }
  return selections;
}

function chapterSegments(plan) {
  return plan.chapter_selections?.length
    ? plan.chapter_selections
    : plan.books.map((book) => ({ book, start: 1, end: BIBLE_CHAPTER_COUNTS.get(book.toLowerCase()) }));
}

function totalChapterCount(plan) {
  return chapterSegments(plan).reduce((total, segment) => total + segment.end - segment.start + 1, 0);
}

function formatChapterSelections(selections) {
  const groups = [];
  for (const selection of selections) {
    let group = groups.at(-1);
    if (!group || group.book !== selection.book) {
      group = { book: selection.book, ranges: [] };
      groups.push(group);
    }
    group.ranges.push(`${selection.start}${selection.start === selection.end ? "" : `–${selection.end}`}`);
  }
  return groups.map((group) => `${group.book} ${group.ranges.join(", ")}`).join("; ");
}

function readingForOffset(plan, offset) {
  const chapters = chaptersForOffset(plan, offset);
  if (!chapters.length) return null;
  const passages = [];
  for (const chapter of chapters) {
    const previous = passages.at(-1);
    if (previous && previous.book === chapter.book && previous.end + 1 === chapter.chapter) {
      previous.end = chapter.chapter;
    } else {
      passages.push({ book: chapter.book, start: chapter.chapter, end: chapter.chapter });
    }
  }
  return formatChapterSelections(passages);
}

function chaptersForOffset(plan, offset) {
  const firstChapterOffset = offset * plan.chapters_per_reading;
  if (!Number.isInteger(offset) || offset < 0 || firstChapterOffset >= plan.total_chapters) return [];
  const endChapterOffset = Math.min(
    plan.total_chapters,
    firstChapterOffset + plan.chapters_per_reading,
  );
  const chapters = [];
  let chapterOffset = 0;
  for (const segment of chapterSegments(plan)) {
    const segmentLength = segment.end - segment.start + 1;
    const overlapStart = Math.max(firstChapterOffset, chapterOffset);
    const overlapEnd = Math.min(endChapterOffset, chapterOffset + segmentLength);
    for (let index = overlapStart; index < overlapEnd; index += 1) {
      const bookKey = segment.book.toLowerCase() === "song of songs" ? "song of solomon" : segment.book.toLowerCase();
      chapters.push({ book: segment.book, book_key: bookKey, chapter: segment.start + index - chapterOffset });
    }
    chapterOffset += segmentLength;
    if (chapterOffset >= endChapterOffset) break;
  }
  return chapters;
}

function normalizeReadingPlan(payload) {
  const requestedTitle = String(payload.title || "").trim();
  const chapterSelections = payload.reading_mode === "chapters" ? normalizeChapterSelections(payload.chapter_selections) : null;
  const books = chapterSelections
    ? [...new Set(chapterSelections.map((selection) => selection.book))]
    : [...new Set(
      (Array.isArray(payload.books) ? payload.books : String(payload.books || "").split(","))
        .map((book) => String(book).trim())
        .filter(Boolean)
        .map(canonicalBookName),
    )];
  const bookTitle = books.join(" + ");
  const title = requestedTitle || (bookTitle.length <= 120
    ? bookTitle
    : `${books[0]} + ${books.length - 1} more books`);
  const chaptersPerReading = Number(payload.chapters_per_reading);
  const intervalDays = Number(payload.interval_days);
  const startDate = String(payload.start_date || "");
  if (!title || title.length > 120 || !books.length || !Number.isInteger(chaptersPerReading) || chaptersPerReading < 1 || chaptersPerReading > 50
    || !Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365 || !validDateKey(startDate)) {
    throw new Error("Choose one or more books, a valid chapter amount, interval, and start date.");
  }
  return {
    title,
    books,
    chapter_selections: chapterSelections,
    chapters_per_reading: chaptersPerReading,
    interval_days: intervalDays,
    start_date: startDate,
  };
}

// --- Book plans, overdue readings, completions, and reading statistics ---
async function bookReadingPlans(date = new Date().toISOString().slice(0, 10)) {
  if (!validDateKey(date)) throw new Error("Use a valid reading plan date.");
  const [{ data: plans, error: planError }, { data: completions, error: completionError }] = await Promise.all([
    supabase.from("study_reading_plans")
      .select("id,title,books,chapter_selections,chapters_per_reading,interval_days,start_date")
      .order("created_at"),
    supabase.from("study_reading_plan_completions").select("plan_id").eq("scheduled_date", date),
  ]);
  if (planError) return fail(planError, "Could not load book reading plans");
  if (completionError) return fail(completionError, "Could not load book reading completions");
  const completedCounts = await Promise.all((plans || []).map(async (plan) => {
    const { count, error } = await supabase.from("study_reading_plan_completions")
      .select("plan_id", { count: "exact", head: true })
      .eq("plan_id", plan.id);
    if (error) return fail(error, "Could not count completed book readings");
    return [plan.id, count || 0];
  }));
  const completedByPlan = new Map(completedCounts);
  const completedToday = new Set((completions || []).map((completion) => completion.plan_id));
  const today = localDateKey();
  const currentDayNumber = dateDayNumber(today);
  const dailyPlans = (plans || []).filter((plan) => plan.interval_days === 1);
  const overdueCompletions = [];
  if (dailyPlans.length) {
    const earliestStart = dailyPlans.reduce(
      (earliest, plan) => plan.start_date < earliest ? plan.start_date : earliest,
      dailyPlans[0].start_date,
    );
    const dailyPlanIds = dailyPlans.map((plan) => plan.id);
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from("study_reading_plan_completions")
        .select("plan_id,scheduled_date")
        .in("plan_id", dailyPlanIds)
        .gte("scheduled_date", earliestStart)
        .lt("scheduled_date", today)
        .order("plan_id")
        .order("scheduled_date")
        .range(offset, offset + pageSize - 1);
      if (error) return fail(error, "Could not load overdue book readings");
      overdueCompletions.push(...(data || []));
      if ((data || []).length < pageSize) break;
    }
  }
  const completedOverdue = new Set(
    overdueCompletions.map((completion) => `${completion.plan_id}:${completion.scheduled_date}`),
  );
  const overdueReadings = [];
  for (const plan of dailyPlans) {
    const totalChapters = totalChapterCount(plan);
    const totalReadings = Math.ceil(totalChapters / plan.chapters_per_reading);
    const planStart = dateDayNumber(plan.start_date);
    const overdueCount = Math.min(totalReadings, Math.max(0, currentDayNumber - planStart));
    for (let index = 0; index < overdueCount; index += 1) {
      const scheduledDate = dateFromDayNumber(planStart + index);
      if (completedOverdue.has(`${plan.id}:${scheduledDate}`)) continue;
      const reference = readingForOffset({ ...plan, total_chapters: totalChapters }, index);
      if (!reference) continue;
      overdueReadings.push({
        plan_id: plan.id,
        title: plan.title,
        scheduled_date: scheduledDate,
        reference,
      });
    }
  }
  overdueReadings.sort((left, right) => left.scheduled_date.localeCompare(right.scheduled_date));
  const todayNumber = dateDayNumber(date);
  const items = (plans || []).map((plan) => {
    const totalChapters = totalChapterCount(plan);
    const totalReadings = Math.ceil(totalChapters / plan.chapters_per_reading);
    const planStart = dateDayNumber(plan.start_date);
    const todayOffset = todayNumber - planStart;
    const todayIndex = todayOffset >= 0 && todayOffset % plan.interval_days === 0
      ? todayOffset / plan.interval_days
      : -1;
    const nextIndex = Math.max(0, Math.ceil(Math.max(0, todayOffset) / plan.interval_days));
    const todayReading = todayIndex >= 0 ? readingForOffset({ ...plan, total_chapters: totalChapters }, todayIndex) : null;
    const nextReading = todayReading ? null : readingForOffset({ ...plan, total_chapters: totalChapters }, nextIndex);
    const nextDate = todayReading ? date : dateFromDayNumber(planStart + nextIndex * plan.interval_days);
    return {
      ...plan,
      reading_scope: plan.chapter_selections?.length ? formatChapterSelections(plan.chapter_selections) : plan.books.join(" + "),
      total_chapters: totalChapters,
      total_readings: totalReadings,
      finish_date: dateFromDayNumber(planStart + (totalReadings - 1) * plan.interval_days),
      completed_readings: completedByPlan.get(plan.id) || 0,
      today_reading: todayReading ? { reference: todayReading, completed: completedToday.has(plan.id) } : null,
      next_reading: nextReading ? { date: nextDate, reference: nextReading } : null,
    };
  });
  const completedItems = items.filter((plan) => plan.completed_readings >= plan.total_readings);
  return {
    items: items.filter((plan) => plan.completed_readings < plan.total_readings),
    completed_items: completedItems,
    date,
    overdue_readings: overdueReadings,
  };
}

async function readingStatistics() {
  const [
    { data: plans, error: planError },
    { count: noteCount, error: noteError },
  ] = await Promise.all([
    supabase.from("study_reading_plans")
      .select("id,books,chapter_selections,chapters_per_reading,interval_days,start_date"),
    supabase.from("study_notes")
      .select("id", { count: "exact", head: true })
      .in("category", NOTE_CATEGORIES),
  ]);
  if (planError) return fail(planError, "Could not load reading statistics");
  if (noteError) return fail(noteError, "Could not count study notes");

  const completions = [];
  const manualReadings = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("study_reading_plan_completions")
      .select("plan_id,scheduled_date,completed_at")
      .order("plan_id")
      .order("scheduled_date")
      .range(offset, offset + pageSize - 1);
    if (error) return fail(error, "Could not load completed reading history");
    completions.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("study_chapter_readings")
      .select("read_date,chapter_selections")
      .order("read_date")
      .range(offset, offset + pageSize - 1);
    if (error) return fail(error, "Could not load manually logged chapter readings");
    manualReadings.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }

  const books = [...BIBLE_CHAPTER_COUNTS.entries()]
    .filter(([book]) => book !== "song of songs")
    .map(([key, chapterCount], index) => ({
      key,
      name: canonicalBookName(key),
      testament: index < 39 ? "Old Testament" : "New Testament",
      total_chapters: chapterCount,
      chapters: Array.from({ length: chapterCount }, (_, chapter) => ({ chapter: chapter + 1, reads: 0 })),
    }));
  const booksByKey = new Map(books.map((book) => [book.key, book]));
  const plansById = new Map((plans || []).map((plan) => [plan.id, plan]));
  const readingDays = new Set();
  let totalChapterReads = 0;

  for (const completion of completions) {
    const plan = plansById.get(completion.plan_id);
    if (!plan) throw new Error("A completed reading could not be matched to its reading plan.");
    const completedAt = new Date(completion.completed_at);
    if (!validDateKey(completion.scheduled_date) || !validDateKey(plan.start_date)
      || !Number.isFinite(completedAt.getTime())) {
      throw new Error("A completed reading contains an invalid date.");
    }
    const totalChapters = totalChapterCount(plan);
    const daysSinceStart = dateDayNumber(completion.scheduled_date) - dateDayNumber(plan.start_date);
    const offset = daysSinceStart / plan.interval_days;
    if (daysSinceStart < 0 || !Number.isInteger(offset)) {
      throw new Error("A completed reading does not match its plan schedule.");
    }
    const chapters = chaptersForOffset({ ...plan, total_chapters: totalChapters }, offset);
    if (!chapters.length) throw new Error("A completed reading has no chapters in its plan.");
    for (const chapter of chapters) {
      const book = booksByKey.get(chapter.book_key);
      if (!book || !book.chapters[chapter.chapter - 1]) {
        throw new Error("A completed reading contains an unknown Bible chapter.");
      }
      book.chapters[chapter.chapter - 1].reads += 1;
      totalChapterReads += 1;
    }
    readingDays.add(localDateKey(completedAt));
  }

  for (const reading of manualReadings) {
    if (!validDateKey(reading.read_date)) throw new Error("A manually logged reading contains an invalid date.");
    const selections = normalizeChapterSelections(formatChapterSelections(reading.chapter_selections));
    for (const selection of selections) {
      const bookKey = selection.book.toLowerCase() === "song of songs" ? "song of solomon" : selection.book.toLowerCase();
      const book = booksByKey.get(bookKey);
      if (!book) throw new Error("A manually logged reading contains an unknown Bible book.");
      for (let chapterNumber = selection.start; chapterNumber <= selection.end; chapterNumber += 1) {
        const chapter = book.chapters[chapterNumber - 1];
        if (!chapter) throw new Error("A manually logged reading contains an unknown Bible chapter.");
        chapter.reads += 1;
        totalChapterReads += 1;
      }
    }
    readingDays.add(reading.read_date);
  }

  const bookStats = books.map((book) => {
    const uniqueChaptersRead = book.chapters.filter((chapter) => chapter.reads > 0).length;
    const chapterReads = book.chapters.reduce((total, chapter) => total + chapter.reads, 0);
    return {
      ...book,
      unique_chapters_read: uniqueChaptersRead,
      chapter_reads: chapterReads,
      completed: uniqueChaptersRead === book.total_chapters,
    };
  });
  const totalBibleChapters = bookStats.reduce((total, book) => total + book.total_chapters, 0);
  const uniqueChaptersRead = bookStats.reduce((total, book) => total + book.unique_chapters_read, 0);
  const bibleReadThroughs = Math.min(...bookStats.flatMap((book) => book.chapters.map((chapter) => chapter.reads)));
  const todayNumber = dateDayNumber(localDateKey());
  let streakDayNumber = todayNumber - (readingDays.has(dateFromDayNumber(todayNumber)) ? 0 : 1);
  let readingStreak = 0;
  while (readingDays.has(dateFromDayNumber(streakDayNumber))) {
    readingStreak += 1;
    streakDayNumber -= 1;
  }
  const testamentStats = ["Old Testament", "New Testament"].map((testament) => {
    const testamentBooks = bookStats.filter((book) => book.testament === testament);
    return {
      name: testament,
      unique_chapters_read: testamentBooks.reduce((total, book) => total + book.unique_chapters_read, 0),
      total_chapters: testamentBooks.reduce((total, book) => total + book.total_chapters, 0),
    };
  });

  return {
    note_count: noteCount || 0,
    completed_readings: completions.length + manualReadings.length,
    reading_days: readingDays.size,
    reading_streak: readingStreak,
    chapter_reads: totalChapterReads,
    unique_chapters_read: uniqueChaptersRead,
    total_chapters: totalBibleChapters,
    bible_read_throughs: bibleReadThroughs,
    completed_books: bookStats.filter((book) => book.completed).length,
    testaments: testamentStats,
    books: bookStats,
  };
}

async function saveBookReadingPlan(payload, id = "") {
  const user = await currentUser();
  const values = { ...normalizeReadingPlan(payload), user_id: user.id };
  const query = id
    ? supabase.from("study_reading_plans").update(values).eq("id", id).select("id").maybeSingle()
    : supabase.from("study_reading_plans").insert(values).select("id").single();
  const { data, error } = await query;
  if (error) return fail(error, "Could not save book reading plan");
  if (!data) throw new Error("Reading plan not found or you do not have permission to edit it.");
  return { id: data.id, status: id ? "updated" : "created" };
}

async function toggleBookReading(planId, date) {
  if (!UUID_PATTERN.test(planId) || !validDateKey(date)) throw new Error("Invalid book reading completion.");
  const user = await currentUser();
  const { data: plan, error: planError } = await supabase.from("study_reading_plans")
    .select("id,books,chapter_selections,chapters_per_reading,interval_days,start_date")
    .eq("id", planId)
    .maybeSingle();
  if (planError) return fail(planError, "Could not load book reading plan");
  if (!plan) throw new Error("Reading plan not found or you do not have permission to access it.");
  const totalChapters = totalChapterCount(plan);
  const daysSinceStart = dateDayNumber(date) - dateDayNumber(plan.start_date);
  const readingIndex = daysSinceStart / plan.interval_days;
  if (daysSinceStart < 0 || !Number.isInteger(readingIndex)
    || !readingForOffset({ ...plan, total_chapters: totalChapters }, readingIndex)) {
    throw new Error("There is no reading scheduled for this plan on that date.");
  }
  const { data: existing, error: findError } = await supabase.from("study_reading_plan_completions")
    .select("plan_id")
    .eq("plan_id", planId)
    .eq("scheduled_date", date)
    .maybeSingle();
  if (findError) return fail(findError, "Could not check book reading completion");
  const query = existing
    ? supabase.from("study_reading_plan_completions").delete().eq("plan_id", planId).eq("scheduled_date", date)
    : supabase.from("study_reading_plan_completions").insert({
      plan_id: planId,
      user_id: user.id,
      scheduled_date: date,
    });
  const { error } = await query;
  if (error) return fail(error, "Could not update book reading completion");
  return { completed: !existing };
}

async function saveChapterReading(payload) {
  const selections = normalizeChapterSelections(payload.chapter_selections);
  const user = await currentUser();
  const { data, error } = await supabase.from("study_chapter_readings")
    .insert({
      user_id: user.id,
      read_date: localDateKey(),
      chapter_selections: selections,
    })
    .select("id")
    .single();
  if (error) return fail(error, "Could not save your chapter reading");
  return {
    id: data.id,
    reference: formatChapterSelections(selections),
    chapter_count: selections.reduce((total, selection) => total + selection.end - selection.start + 1, 0),
  };
}

async function deleteBookReadingPlan(id) {
  if (!UUID_PATTERN.test(id)) throw new Error("Invalid book reading plan.");
  const { data, error } = await supabase.from("study_reading_plans").delete().eq("id", id).select("id");
  if (error) return fail(error, "Could not delete book reading plan");
  if (!data?.length) throw new Error("Reading plan not found or you do not have permission to delete it.");
  return { status: "deleted" };
}

// --- Recurring task schedules, completions, and ESV lookup ---
async function taskPlan(date = new Date().toISOString().slice(0, 10)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Use a valid task date.");
  const user = await currentUser();
  const [{ data: tasks, error: taskError }, { data: completed, error: completionError }] = await Promise.all([
    supabase.from("study_tasks").select("id,task_type,title,details,weekdays").order("created_at"),
    supabase.from("study_task_completions").select("task_id").eq("completion_date", date),
  ]);
  if (taskError) return fail(taskError, "Could not load recurring tasks");
  if (completionError) return fail(completionError, "Could not load task completions");
  const done = new Set((completed || []).map((item) => item.task_id));
  const weekday = new Date(`${date}T12:00:00`).getDay();
  return {
    tasks: tasks || [],
    items: (tasks || []).filter((task) => task.weekdays.includes(weekday)).map((task) => ({ ...task, completed: done.has(task.id) })),
    date,
    user_id: user.id,
  };
}

async function saveTask(payload, id = "") {
  const user = await currentUser();
  const weekdays = [...new Set((Array.isArray(payload.weekdays) ? payload.weekdays : []).map(Number))].sort();
  const title = String(payload.title || "").trim();
  if (!TASK_TYPES.includes(payload.task_type) || !title || title.length > 120 || !weekdays.length || weekdays.some((day) => day < 0 || day > 6)) {
    throw new Error("Choose a task type, name, and at least one repeat day.");
  }
  const values = { user_id: user.id, task_type: payload.task_type, title, details: String(payload.details || "").trim().slice(0, 300), weekdays };
  const query = id
    ? supabase.from("study_tasks").update(values).eq("id", id).select("id").maybeSingle()
    : supabase.from("study_tasks").insert(values).select("id").single();
  const { data, error } = await query;
  if (error) return fail(error, "Could not save recurring task");
  if (!data) throw new Error("Task not found or you do not have permission to edit it.");
  return { id: data.id, status: id ? "updated" : "created" };
}

async function toggleTask(taskId, date) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid task completion.");
  const user = await currentUser();
  const { data: existing, error: findError } = await supabase.from("study_task_completions").select("task_id").eq("task_id", taskId).eq("completion_date", date).maybeSingle();
  if (findError) return fail(findError, "Could not check task completion");
  const query = existing
    ? supabase.from("study_task_completions").delete().eq("task_id", taskId).eq("completion_date", date)
    : supabase.from("study_task_completions").insert({ task_id: taskId, user_id: user.id, completion_date: date });
  const { error } = await query;
  if (error) return fail(error, "Could not update task completion");
  return { completed: !existing };
}

async function deleteTask(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid recurring task.");
  const { data, error } = await supabase.from("study_tasks").delete().eq("id", id).select("id");
  if (error) return fail(error, "Could not delete recurring task");
  if (!data?.length) throw new Error("Task not found or you do not have permission to delete it.");
  return { status: "deleted" };
}

async function esvLookup(reference) {
  const { data, error } = await supabase.functions.invoke("esv-lookup", { body: { q: reference } });
  if (error) return fail(error, "Passage lookup failed");
  return data;
}

// --- Note image operations and transcription replacement ---
async function addImage(path, file) {
  const note = await noteByPath(path);
  const { filename, storagePath } = await uploadImage(file);
  const addition = `\n\n## Image upload — ${new Date().toISOString()}\n\n![Uploaded handwritten page](${relativeImagePath(path, filename)})\n`;
  try {
    await putContent(path, `${note.content.trimEnd()}${addition}`);
  } catch (error) {
    throw new Error(`${error.message} The uploaded image was kept in storage in case the note update completed.`);
  }
  return { path, image: filename, status: "added" };
}

function removeImageLinks(content, filename) {
  return content.replace(IMAGE_LINK, (whole, alt, destination) => {
    return destination.endsWith(`_uploads/${filename}`) ? "" : whole;
  }).replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n");
}

function replaceImageLinks(content, oldFilename, newFilename) {
  return content.replace(IMAGE_LINK, (whole, alt, destination) => (
    destination.endsWith(`_uploads/${oldFilename}`)
      ? `![${alt || "Uploaded handwritten page"}](${destination.slice(0, -oldFilename.length)}${newFilename})`
      : whole
  ));
}

function replaceTranscription(content, filename, markdown) {
  const marker = `<!-- image-transcription:${filename} -->`;
  const at = content.indexOf(marker);
  if (at < 0) {
    throw new Error("This image has no separately marked transcription to replace safely.");
  }
  const start = at + marker.length;
  const nextMarker = content.indexOf("<!-- image-transcription:", start);
  const nextImage = [...content.slice(start).matchAll(IMAGE_LINK)][0];
  const boundaries = [nextMarker, nextImage ? start + nextImage.index : -1].filter((value) => value >= 0);
  const end = boundaries.length ? Math.min(...boundaries) : content.length;
  return `${content.slice(0, start)}\n\n${markdown}\n\n${content.slice(end)}`;
}

async function noteImageAction(path, method, params, formData) {
  if (path.startsWith("daily/")) throw new Error("Reading-plan entries cannot have image attachments.");
  const filename = params.get("image_name");
  if (method === "POST") return addImage(path, formData.get("file"));
  if (!filename || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)) throw new Error("Invalid image name.");
  const note = await noteByPath(path);
  const links = imageReferences(note.content);
  if (!links.includes(filename)) throw new Error("That image is not attached to this note.");

  if (method === "DELETE") {
    const content = removeImageLinks(note.content, filename);
    await putContent(path, content);
    const otherNotes = (await allNotes()).filter((item) => item.path !== path);
    const shared = otherNotes.some((item) => imageReferences(item.content).includes(filename));
    if (!shared) {
      const user = await currentUser();
      await storageDelete([`${user.id}/${filename}`]);
    }
    return { path, status: "deleted", file_kept_for_other_notes: shared };
  }

  if (method === "PUT") {
    const file = formData.get("file");
    const { filename: nextName, storagePath } = await uploadImage(file);
    let content = note.content;
    const regenerate = formData.get("regenerate_transcription") === "true";
    let writeStarted = false;
    try {
      if (regenerate) {
        const result = await transcribeUploadedImage(file);
        const text = result.notes.map((item) => item.transcription).filter(Boolean).join("\n\n");
        if (!text) throw new Error("No handwritten text could be regenerated from this image.");
        content = replaceTranscription(content, filename, text);
      }
      content = replaceImageLinks(content, filename, nextName);
      writeStarted = true;
      await putContent(path, content);
    } catch (error) {
      if (!writeStarted) await storageDelete([storagePath]);
      else throw new Error(`${error.message} The replacement image was kept in storage in case the note update completed.`);
      throw error;
    }
    const otherNotes = (await allNotes()).filter((item) => item.path !== path);
    const shared = otherNotes.some((item) => imageReferences(item.content).includes(filename));
    if (!shared) {
      const user = await currentUser();
      await storageDelete([`${user.id}/${filename}`]);
    }
    return { path, image: nextName, status: "updated", transcription_regenerated: regenerate };
  }
  throw new Error("Unsupported image action.");
}

// --- API request routing for the browser app ---
function decodePath(value) {
  return value.split("/").map((part) => decodeURIComponent(part)).join("/");
}

export async function apiRequest(url, options = {}) {
  await currentUser();
  const parsed = new URL(url, window.location.origin);
  const method = (options.method || "GET").toUpperCase();
  const path = parsed.pathname;
  if (path === "/api/folders" && method === "GET") return listFolders();
  if (path === "/api/search/notes" && method === "GET") return searchNotes(parsed.searchParams);
  if (path === "/api/book-reading-plans" && method === "GET") return bookReadingPlans(parsed.searchParams.get("date") || undefined);
  if (path === "/api/book-reading-plans" && method === "POST") return saveBookReadingPlan(JSON.parse(options.body));
  if (path === "/api/chapter-readings" && method === "POST") return saveChapterReading(JSON.parse(options.body));
  if (path === "/api/reading-statistics" && method === "GET") return readingStatistics();
  if (path === "/api/tasks" && method === "GET") return taskPlan(parsed.searchParams.get("date") || undefined);
  if (path === "/api/tasks" && method === "POST") return saveTask(JSON.parse(options.body));
  const bookPlanToggle = path.match(/^\/api\/book-reading-plans\/([0-9a-f-]+)\/toggle$/i);
  if (bookPlanToggle && method === "POST") return toggleBookReading(bookPlanToggle[1], parsed.searchParams.get("date") || "");
  const bookPlan = path.match(/^\/api\/book-reading-plans\/([0-9a-f-]+)$/i);
  if (bookPlan && method === "PUT") return saveBookReadingPlan(JSON.parse(options.body), bookPlan[1]);
  if (bookPlan && method === "DELETE") return deleteBookReadingPlan(bookPlan[1]);
  const taskToggle = path.match(/^\/api\/tasks\/([0-9a-f-]+)\/toggle$/i);
  if (taskToggle && method === "POST") return toggleTask(taskToggle[1], parsed.searchParams.get("date") || "");
  const task = path.match(/^\/api\/tasks\/([0-9a-f-]+)$/i);
  if (task && method === "PUT") return saveTask(JSON.parse(options.body), task[1]);
  if (task && method === "DELETE") return deleteTask(task[1]);
  if (path === "/api/uploads" && method === "POST") return uploadBatch(options.body);
  if (path === "/api/esv" && method === "GET") return esvLookup(parsed.searchParams.get("q") || "");
  const noteImage = path.match(/^\/api\/note-images\/(.+)$/);
  if (noteImage) return noteImageAction(decodePath(noteImage[1]), method, parsed.searchParams, options.body);
  const note = path.match(/^\/api\/note\/(.+)$/);
  if (note) {
    const notePath = decodePath(note[1]);
    if (method === "GET") {
      const row = await noteByPath(notePath);
      return { path: row.path, content: row.content, title: row.title, reference: row.reference };
    }
    if (method === "POST") {
      const payload = JSON.parse(options.body);
      if (typeof payload.content !== "string") throw new Error("Note content must be Markdown text.");
      return saveNote(notePath, payload.content);
    }
    if (method === "DELETE") {
      if (notePath.startsWith("daily/")) throw new Error("Reading plan entries cannot be deleted here.");
      const existing = await noteByPath(notePath);
      const filenames = imageReferences(existing.content);
      const { data, error } = await supabase.from("study_notes").delete().eq("path", safePath(notePath)).select("path");
      if (error) return fail(error, "Could not delete note");
      if (!data?.length) throw new Error("Note not found or you do not have permission to delete it.");
      const remaining = await allNotes();
      const stillUsed = new Set(remaining.flatMap((item) => imageReferences(item.content)));
      const orphaned = [...new Set(filenames)].filter((filename) => !stillUsed.has(filename));
      const user = await currentUser();
      await storageDelete(orphaned.map((filename) => `${user.id}/${filename}`));
      return { path: notePath, status: "deleted", images_deleted: orphaned.length };
    }
  }
  throw new Error(`Unsupported app request: ${method} ${path}`);
}
