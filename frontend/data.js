import { supabase } from "./supabase-client.js";

// --- Shared note, image, and Scripture reference configuration ---
const NOTE_CATEGORIES = ["exegesis", "topics", "church-history"];
const NOTE_IDENTIFIER_PATTERN = /(?<![A-Z0-9])((?:CH|[ET])\d{3})(?!\d)/i;
const NOTE_IDENTIFIER_FULL_PATTERN = /^(?:CH|[ET])\d{3}$/i;
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
  if (!title || /^\d{6,}$/.test(title) || /^(?:CH|[ET])\d{3}$/i.test(title)) {
    title = heading || path.split("/").at(-1).replace(/\.md$/i, "");
  }
  const idFromText = content.slice(0, 2200).match(NOTE_IDENTIFIER_PATTERN)?.[1]?.toUpperCase();
  const idValue = String(metadata.identifier || metadata.id || "").toUpperCase();
  const identifier = NOTE_IDENTIFIER_FULL_PATTERN.test(idValue) ? idValue : idFromText || null;
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

async function allNotes(includeContent = false) {
  const columns = includeContent
    ? "id,user_id,path,content,title,category,note_date,identifier,reference,created_at,updated_at"
    : "id,user_id,path,title,category,note_date,identifier,reference,updated_at";
  const { data, error } = await supabase
    .from("study_notes")
    .select(columns)
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

async function transcribeImage(storagePath, imagePayload = null) {
  const { data, error } = await supabase.functions.invoke("transcribe-image", {
    body: imagePayload
      ? { imageBase64: imagePayload.base64, contentType: imagePayload.contentType }
      : { imagePath: storagePath },
  });
  if (error) {
    if (error.context?.status === 503) return localOcr(storagePath, imagePayload);
    return fail(error, "Image transcription failed");
  }
  if (!Array.isArray(data?.notes)) throw new Error("Transcription returned an invalid response.");
  return data;
}

async function localOcr(storagePath, imagePayload = null) {
  let image;
  if (imagePayload) {
    const bytes = Uint8Array.from(atob(imagePayload.base64), (character) => character.charCodeAt(0));
    image = new Blob([bytes], { type: imagePayload.contentType || "image/jpeg" });
  } else {
    const downloaded = await supabase.storage.from("study-images").download(storagePath);
    if (downloaded.error) return fail(downloaded.error, "Could not load image for browser OCR");
    image = downloaded.data;
  }
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
    const identifier = markdown.match(NOTE_IDENTIFIER_PATTERN)?.[1]?.toUpperCase() || "";
    const firstLine = markdown.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
    const title = firstLine.split(/\s+/).length <= 8 ? firstLine : "";
    const category = identifier.startsWith("CH")
      ? "church-history"
      : identifier.startsWith("E")
        ? "exegesis"
        : "topics";
    return {
      provider: "browser",
      notes: [{
        transcription: markdown,
        category,
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
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/i, ""));
    reader.onerror = () => reject(new Error("Could not prepare the image for transcription."));
    reader.readAsDataURL(transcriptionFile);
  });
  return await transcribeImage(null, { base64, contentType: "image/jpeg" });
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
      const textIdentifier = markdown.match(NOTE_IDENTIFIER_PATTERN)?.[1] || "";
      const identifier = NOTE_IDENTIFIER_FULL_PATTERN.test(suppliedIdentifier)
        ? suppliedIdentifier.toUpperCase()
        : textIdentifier.toUpperCase();
      const category = identifier.startsWith("CH")
        ? "church-history"
        : identifier.startsWith("E")
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
      if (!path && !identifier && continuationPath && segments.length === 1) {
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
      const current = notesByPath.get(item.path)
        ? await noteByPath(item.path)
        : null;
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
      note_title: changedPaths.length ? (grouped.get(changedPaths[0])?.title || "") : "",
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
      const latestPath = result.note_paths.at(-1) || result.note_path;
      if (latestPath) {
        continuationPath = latestPath;
        const latestTitle = result.note_title || latestPath.split("/").at(-1).replace(/\.md$/i, "");
        sessionStorage.setItem("scripture-study:last-uploaded-note", JSON.stringify({
          path: latestPath,
          title: latestTitle,
        }));
      }
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
  return allNotes(true).then((notes) => {
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
      if (idType === "CH" && !note.identifier?.startsWith("CH")) return false;
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
let activeReaderProfileId = null;

export function setActiveReaderProfile(profileId) {
  activeReaderProfileId = typeof profileId === "string" && UUID_PATTERN.test(profileId) ? profileId : null;
}

async function readerProfiles() {
  const { data, error } = await supabase
    .from("reader_profiles")
    .select("id,name,owner_user_id,shared_emails,created_at")
    .order("name");
  if (error) return fail(error, "Could not load managed reader profiles");
  return data || [];
}

async function createReaderProfile(payload) {
  const user = await currentUser();
  const name = String(payload.name || "").trim();
  const sharedEmails = [...new Set((Array.isArray(payload.shared_emails) ? payload.shared_emails : [])
    .map((email) => String(email).trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
  if (!name || name.length > 80) throw new Error("Enter a reader name between 1 and 80 characters.");
  const { data, error } = await supabase
    .from("reader_profiles")
    .insert({ name, owner_user_id: user.id, shared_emails: sharedEmails })
    .select("id,name,owner_user_id,shared_emails,created_at")
    .single();
  if (error) return fail(error, "Could not create managed reader profile");
  return data;
}

async function updateReaderProfile(id, payload) {
  if (!UUID_PATTERN.test(id)) throw new Error("Invalid managed reader profile.");
  const values = {};
  if (payload.name !== undefined) {
    const name = String(payload.name).trim();
    if (!name || name.length > 80) throw new Error("Enter a reader name between 1 and 80 characters.");
    values.name = name;
  }
  if (payload.shared_emails !== undefined) {
    values.shared_emails = [...new Set((Array.isArray(payload.shared_emails) ? payload.shared_emails : [])
      .map((email) => String(email).trim().toLowerCase())
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
  }
  const { data, error } = await supabase
    .from("reader_profiles")
    .update(values)
    .eq("id", id)
    .select("id,name,owner_user_id,shared_emails,created_at")
    .maybeSingle();
  if (error) return fail(error, "Could not update managed reader profile");
  if (!data) throw new Error("Managed reader profile not found or you do not have permission to edit it.");
  return data;
}

async function deleteReaderProfile(id) {
  if (!UUID_PATTERN.test(id)) throw new Error("Invalid managed reader profile.");
  const { error } = await supabase.from("reader_profiles").delete().eq("id", id);
  if (error) return fail(error, "Could not remove managed reader profile");
  return { status: "deleted", id };
}
const READING_TIME_ZONE = "America/New_York";

export function dateKeyInNewYork(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: READING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

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

function canonicalBookName(value) {
  const canonical = [...BIBLE_CHAPTER_COUNTS.keys()].find((name) => name.toLowerCase() === value.trim().toLowerCase());
  if (!canonical) throw new Error(`Unknown Bible book: ${value}. Use full book names.`);
  return canonical.replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/\b(Of|The)\b/g, (word) => word.toLowerCase());
}

export function normalizeChapterSelections(value) {
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

export function totalChapterCount(plan) {
  return chapterSegments(plan).reduce((total, segment) => total + segment.end - segment.start + 1, 0);
}

export function scheduledDateForIndex(plan, index) {
  if (plan.cadence_type === "weekdays" && Array.isArray(plan.weekdays) && plan.weekdays.length > 0) {
    const dayNumber = dateDayNumber(plan.start_date);
    let matchCount = -1;
    for (let i = 0; i < 10000; i += 1) {
      const dateStr = dateFromDayNumber(dayNumber + i);
      const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
      if (plan.weekdays.includes(weekday)) {
        matchCount += 1;
        if (matchCount === index) {
          return dateStr;
        }
      }
    }
  }
  const interval = plan.interval_days || 1;
  return dateFromDayNumber(dateDayNumber(plan.start_date) + index * interval);
}

export function readingIndexForDate(plan, dateKey) {
  if (!validDateKey(dateKey) || !validDateKey(plan.start_date) || dateKey < plan.start_date) {
    return -1;
  }
  if (plan.cadence_type === "weekdays" && Array.isArray(plan.weekdays) && plan.weekdays.length > 0) {
    const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
    if (!plan.weekdays.includes(weekday)) return -1;
    const startDay = dateDayNumber(plan.start_date);
    const targetDay = dateDayNumber(dateKey);
    let count = 0;
    for (let day = startDay; day <= targetDay; day += 1) {
      const dStr = dateFromDayNumber(day);
      const w = new Date(`${dStr}T12:00:00Z`).getUTCDay();
      if (plan.weekdays.includes(w)) {
        count += 1;
      }
    }
    return count - 1;
  }
  const daysSinceStart = dateDayNumber(dateKey) - dateDayNumber(plan.start_date);
  const interval = plan.interval_days || 1;
  if (daysSinceStart % interval !== 0) return -1;
  return daysSinceStart / interval;
}

export function formatCadence(plan) {
  if (plan.cadence_type === "weekdays" && Array.isArray(plan.weekdays) && plan.weekdays.length > 0) {
    if (plan.weekdays.length === 7) return "every day";
    const weekdaysSorted = [...plan.weekdays].sort((a, b) => a - b);
    const isMonFri = weekdaysSorted.length === 5 && weekdaysSorted.every((d, i) => d === i + 1);
    if (isMonFri) return "every weekday (Mon–Fri)";
    const isWeekend = weekdaysSorted.length === 2 && weekdaysSorted[0] === 0 && weekdaysSorted[1] === 6;
    if (isWeekend) return "weekends (Sat–Sun)";
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `on ${weekdaysSorted.map((d) => dayNames[d]).join(", ")}`;
  }
  const interval = plan.interval_days || 1;
  return interval === 1 ? "every day" : `every ${interval} days`;
}

function groupChaptersToSelections(chapters) {
  const selections = [];
  for (const item of chapters) {
    const prev = selections.at(-1);
    if (prev && prev.book === item.book && prev.end + 1 === item.chapter) {
      prev.end = item.chapter;
    } else {
      selections.push({ book: item.book, start: item.chapter, end: item.chapter });
    }
  }
  return selections;
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
  const customQueue = payload.reading_mode === "custom";
  const requestedTitle = String(payload.title || "").trim();
  const chapterSelections = customQueue ? null : payload.reading_mode === "chapters" ? normalizeChapterSelections(payload.chapter_selections) : null;
  const books = customQueue ? [] : chapterSelections
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
  const startDate = String(payload.start_date || "");

  const cadenceType = payload.cadence_type === "weekdays" ? "weekdays" : "interval";
  let intervalDays = Number(payload.interval_days);
  let weekdays = null;

  if (cadenceType === "weekdays") {
    weekdays = [...new Set((Array.isArray(payload.weekdays) ? payload.weekdays : []).map(Number))].sort((a, b) => a - b);
    if (!weekdays.length || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new Error("Select at least one day of the week for this reading plan.");
    }
    intervalDays = Number.isInteger(intervalDays) && intervalDays >= 1 && intervalDays <= 365 ? intervalDays : 1;
  } else {
    if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) {
      throw new Error("Enter a valid interval between 1 and 365 days.");
    }
  }

  let collaboratorEmail = null;
  if (payload.collaborator_email) {
    const email = String(payload.collaborator_email).trim().toLowerCase();
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("Enter a valid partner email address.");
      }
      collaboratorEmail = email;
    }
  }

  if (!title || title.length > 120 || (!customQueue && !books.length)
    || !Number.isInteger(chaptersPerReading) || chaptersPerReading < 1 || chaptersPerReading > 50
    || !validDateKey(startDate)) {
    throw new Error("Choose one or more books, a valid chapter amount, cadence, and start date.");
  }
  return {
    title,
    books,
    chapter_selections: chapterSelections,
    chapters_per_reading: chaptersPerReading,
    cadence_type: cadenceType,
    interval_days: intervalDays,
    weekdays,
    collaborator_email: collaboratorEmail,
    status: payload.status && ["active", "paused", "completed", "archived"].includes(payload.status) ? payload.status : "active",
    start_date: startDate,
  };
}

// --- Explicit reading plan items, unified reading logs, and statistics ---
function planItemSelections(plan, offset) {
  const chapters = chaptersForOffset({ ...plan, total_chapters: totalChapterCount(plan) }, offset);
  return groupChaptersToSelections(chapters.map(({ book, chapter }) => ({ book, chapter })));
}

function generatePlanItems(plan, startDate, sortStart = 0) {
  const totalReadings = Math.ceil(totalChapterCount(plan) / plan.chapters_per_reading);
  return Array.from({ length: totalReadings }, (_, index) => ({
    plan_id: plan.id,
    user_id: plan.user_id,
    profile_id: activeReaderProfileId,
    sort_order: sortStart + index,
    scheduled_date: scheduledDateForIndex({ ...plan, start_date: startDate }, index),
    chapter_selections: planItemSelections(plan, index),
    status: "pending",
  }));
}

async function fetchReadingPlans() {
  const columns = "id,title,books,chapter_selections,chapters_per_reading,interval_days,start_date,weekdays,cadence_type,status,collaborator_email,owner_email,user_id,created_at";
  let query = supabase.from("study_reading_plans").select(columns).order("created_at");
  query = activeReaderProfileId
    ? query.eq("profile_id", activeReaderProfileId)
    : query.is("profile_id", null);
  const { data, error } = await query;
  if (error) return fail(error, "Could not load book reading plans");
  return data || [];
}

async function allPlanItems() {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from("study_reading_plan_items")
      .select("id,plan_id,user_id,sort_order,scheduled_date,chapter_selections,status,completed_date,notes")
      .order("plan_id").order("sort_order").order("id")
      .range(offset, offset + pageSize - 1);
    query = activeReaderProfileId
      ? query.eq("profile_id", activeReaderProfileId)
      : query.is("profile_id", null);
    const { data, error } = await query;
    if (error) return fail(error, "Could not load reading plan items");
    rows.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }
  return rows;
}

async function ensureLegacyPlanItems(plans, currentItems) {
  const populatedPlanIds = new Set(currentItems.map((item) => item.plan_id));
  const user = await currentUser();
  for (const plan of plans) {
    if (populatedPlanIds.has(plan.id) || !plan.books?.length || !plan.chapters_per_reading) continue;
    const { data: completions, error: completionError } = await supabase.from("study_reading_plan_completions")
      .select("user_id,scheduled_date,completed_at").eq("plan_id", plan.id);
    if (completionError) return fail(completionError, "Could not migrate existing reading plan completions");
    const completedByDate = new Map((completions || []).map((completion) => [completion.scheduled_date, completion]));
    const generated = generatePlanItems(plan, plan.start_date);
    const legacyRows = generated.map((item) => {
      const completion = completedByDate.get(item.scheduled_date);
      return completion
        ? { ...item, status: "completed", completed_date: completion.scheduled_date }
        : item;
    });
    const insertedItems = [];
    for (let offset = 0; offset < legacyRows.length; offset += 500) {
      const { data, error } = await supabase.from("study_reading_plan_items")
        .insert(legacyRows.slice(offset, offset + 500)).select("id,scheduled_date,chapter_selections");
      if (error) {
        const insertedIds = insertedItems.map((item) => item.id);
        if (insertedIds.length) {
          const { error: cleanupError } = await supabase.from("study_reading_plan_items").delete().in("id", insertedIds);
          if (cleanupError) throw new Error(`${error.message} Could not roll back partially migrated plan items: ${cleanupError.message}`);
        }
        return fail(error, "Could not migrate existing reading plan items");
      }
      insertedItems.push(...(data || []));
    }
    const matchingItems = new Map(insertedItems.map((item) => [item.scheduled_date, item]));
    const ownLogs = (completions || [])
      .filter((completion) => completion.user_id === user.id && matchingItems.has(completion.scheduled_date))
      .map((completion) => {
        const item = matchingItems.get(completion.scheduled_date);
        return {
          user_id: user.id,
          profile_id: activeReaderProfileId,
          read_date: completion.scheduled_date,
          chapter_selections: item.chapter_selections,
          source_type: "plan",
          plan_id: plan.id,
          plan_item_id: item.id,
          created_at: completion.completed_at,
        };
      });
    for (let offset = 0; offset < ownLogs.length; offset += 500) {
      const { error } = await supabase.from("reading_logs").insert(ownLogs.slice(offset, offset + 500));
      if (error) return fail(error, "Could not migrate reading plan logs");
    }
    populatedPlanIds.add(plan.id);
  }
  return allPlanItems();
}

async function bookReadingPlans(date = dateKeyInNewYork()) {
  if (!validDateKey(date)) throw new Error("Use a valid reading plan date.");
  const plans = await fetchReadingPlans();
  const planItems = await ensureLegacyPlanItems(plans, await allPlanItems());
  const itemsByPlan = new Map();
  for (const item of planItems) {
    const rows = itemsByPlan.get(item.plan_id) || [];
    rows.push(item);
    itemsByPlan.set(item.plan_id, rows);
  }
  const overdueReadings = [];
  const enriched = plans.map((plan) => {
    const queue = itemsByPlan.get(plan.id) || [];
    const selections = queue.flatMap((item) => item.chapter_selections || []);
    const totalChapters = selections.reduce((sum, selection) => sum + selection.end - selection.start + 1, 0);
    const completedReadings = queue.filter((item) => item.status === "completed").length;
    const completedChapters = queue.filter((item) => item.status === "completed")
      .flatMap((item) => item.chapter_selections || [])
      .reduce((sum, selection) => sum + selection.end - selection.start + 1, 0);
    const readings = queue.filter((item) => item.scheduled_date === date).map((item) => ({
      item_id: item.id,
      reference: formatChapterSelections(item.chapter_selections),
      completed: item.status === "completed",
      skipped: item.status === "skipped",
      chapter_selections: item.chapter_selections,
      scheduled_date: item.scheduled_date,
    }));
    if (plan.status === "active") {
      queue.filter((item) => item.status === "pending" && item.scheduled_date && item.scheduled_date < date)
        .forEach((item) => overdueReadings.push({
          plan_id: plan.id,
          item_id: item.id,
          title: plan.title,
          scheduled_date: item.scheduled_date,
          reference: formatChapterSelections(item.chapter_selections),
          chapter_selections: item.chapter_selections,
          collaborator_email: plan.collaborator_email || null,
        }));
    }
    const pending = queue.filter((item) => item.status === "pending");
    const next = pending.find((item) => item.scheduled_date >= date) || pending[0] || null;
    const orderedSelections = [];
    const seenChapters = new Set();
    const editableSelections = [];
    const seenEditableChapters = new Set();
    for (const item of queue) {
      for (const selection of item.chapter_selections || []) {
        for (let chapter = selection.start; chapter <= selection.end; chapter += 1) {
          const key = `${selection.book.toLowerCase()}:${chapter}`;
          if (!seenChapters.has(key)) {
            seenChapters.add(key);
            orderedSelections.push({ book: selection.book, start: chapter, end: chapter });
          }
          if (item.status === "pending" && !seenEditableChapters.has(key)) {
            seenEditableChapters.add(key);
            editableSelections.push({ book: selection.book, start: chapter, end: chapter });
          }
        }
      }
    }
    const derivedSelections = groupChaptersToSelections(editableSelections.map((selection) => ({
      book: selection.book,
      chapter: selection.start,
    })));
    const derivedBooks = derivedSelections
      .filter((selection) => selection.start === 1
        && selection.end === BIBLE_CHAPTER_COUNTS.get(selection.book.toLowerCase()))
      .map((selection) => selection.book);
    const wholeBooksOnly = derivedSelections.length > 0
      && derivedBooks.length === derivedSelections.length;
    return {
      ...plan,
      plan_items: queue,
      books: wholeBooksOnly ? derivedBooks : derivedSelections.length ? [] : plan.books || [],
      chapter_selections: wholeBooksOnly || !derivedSelections.length ? null : derivedSelections,
      reading_scope: orderedSelections.length ? formatChapterSelections(orderedSelections) : "Custom reading queue",
      total_chapters: totalChapters,
      total_readings: queue.length,
      finish_date: queue.at(-1)?.scheduled_date || null,
      completed_readings: completedReadings,
      completed_chapters: completedChapters,
      readings,
      today_reading: readings[0] || null,
      next_reading: next ? {
        date: next.scheduled_date,
        reference: formatChapterSelections(next.chapter_selections),
      } : null,
    };
  });
  overdueReadings.sort((left, right) => left.scheduled_date.localeCompare(right.scheduled_date));
  return {
    items: enriched.filter((plan) => ["active", "paused", "completed"].includes(plan.status)),
    completed_items: enriched.filter((plan) => plan.status === "completed"),
    cancelled_items: enriched.filter((plan) => plan.status === "archived"),
    date,
    overdue_readings: overdueReadings,
  };
}

async function readingDayStatus(date = dateKeyInNewYork()) {
  if (!validDateKey(date)) throw new Error("Use a valid reading date.");
  await backfillLegacyChapterReadings();
  let logQuery = supabase.from("reading_logs")
    .select("id", { count: "exact", head: true })
    .eq("read_date", date);
  logQuery = activeReaderProfileId
    ? logQuery.eq("profile_id", activeReaderProfileId)
    : logQuery.is("profile_id", null);
  const { count, error } = await logQuery;
  if (error) return fail(error, "Could not check reading logs");
  return { date, has_read: (count || 0) > 0 };
}

async function fetchReadingLogs(date) {
  if (date) {
    if (!validDateKey(date)) throw new Error("Use a valid reading log date.");
  }
  await backfillLegacyChapterReadings();
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from("reading_logs")
      .select("id,user_id,profile_id,read_date,chapter_selections,source_type,plan_id,plan_item_id,created_at,legacy_source_id")
      .order("read_date", { ascending: false }).order("created_at").order("id")
      .range(offset, offset + pageSize - 1);
    query = activeReaderProfileId
      ? query.eq("profile_id", activeReaderProfileId)
      : query.is("profile_id", null);
    if (date) query = query.eq("read_date", date);
    const { data, error } = await query;
    if (error) return fail(error, "Could not load reading logs");
    rows.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }
  return rows.map((log) => ({
    ...log,
    reference: formatChapterSelections(log.chapter_selections),
  }));
}

async function backfillLegacyChapterReadings() {
  const { error } = await supabase.rpc("backfill_legacy_chapter_readings");
  if (error) return fail(error, "Could not import existing chapter readings");
}

async function readingStatistics() {
  const [{ count: noteCount, error: noteError }, logs] = await Promise.all([
    activeReaderProfileId
      ? Promise.resolve({ count: 0, error: null })
      : supabase.from("study_notes").select("id", { count: "exact", head: true }).in("category", NOTE_CATEGORIES),
    fetchReadingLogs(),
  ]);
  if (noteError) return fail(noteError, "Could not count study notes");
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
  const readingDays = new Set();
  let totalChapterReads = 0;
  for (const log of logs) {
    if (!validDateKey(log.read_date)) continue;
    for (const selection of log.chapter_selections || []) {
      const bookKey = selection.book.toLowerCase() === "song of songs" ? "song of solomon" : selection.book.toLowerCase();
      const book = booksByKey.get(bookKey);
      if (!book) continue;
      for (let chapterNumber = selection.start; chapterNumber <= selection.end; chapterNumber += 1) {
        const chapter = book.chapters[chapterNumber - 1];
        if (!chapter) continue;
        chapter.reads += 1;
        totalChapterReads += 1;
      }
    }
    readingDays.add(log.read_date);
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
  const todayKey = dateKeyInNewYork();
  const todayNumber = dateDayNumber(todayKey);
  let streakDayNumber = readingDays.has(todayKey) ? todayNumber : todayNumber - 1;
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
    completed_readings: logs.length,
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
  const normalized = normalizeReadingPlan(payload);
  const { books, chapter_selections: chapterSelections, ...metadata } = normalized;
  const planValues = {
    ...metadata,
    user_id: user.id,
    owner_email: user.email || null,
    profile_id: activeReaderProfileId,
  };
  let planId = id;
  let planOwnerId = user.id;
  let planOwnerEmail = user.email || null;
  let previousStatus = "active";
  let oldPendingIds = [];
  if (id) {
    const { data: current, error: currentError } = await supabase.from("study_reading_plans")
      .select("id,status,user_id,owner_email").eq("id", id).maybeSingle();
    if (currentError) return fail(currentError, "Could not load book reading plan");
    if (!current) throw new Error("Reading plan not found or you do not have permission to edit it.");
    previousStatus = current.status || "active";
    if (previousStatus === "completed") previousStatus = "active";
    planOwnerId = current.user_id;
    planOwnerEmail = current.owner_email;
    const { data: pending, error: pendingError } = await supabase.from("study_reading_plan_items")
      .select("id").eq("plan_id", id).eq("status", "pending");
    if (pendingError) return fail(pendingError, "Could not load remaining reading plan items");
    oldPendingIds = (pending || []).map((item) => item.id);
  } else {
    const { data, error } = await supabase.from("study_reading_plans")
      .insert(planValues).select("id").single();
    if (error) return fail(error, "Could not save book reading plan");
    planId = data.id;
  }
  const { data: existingItems, error: itemsError } = await supabase.from("study_reading_plan_items")
    .select("sort_order").eq("plan_id", planId).order("sort_order", { ascending: false }).limit(1);
  if (itemsError) return fail(itemsError, "Could not load reading plan order");
  const nextOrder = existingItems?.length ? existingItems[0].sort_order + 1 : 0;
  const plan = { ...normalized, ...planValues, books, chapter_selections: chapterSelections, id: planId, user_id: planOwnerId };
  const generated = generatePlanItems(plan, planValues.start_date, nextOrder);
  const insertedIds = [];
  for (let offset = 0; offset < generated.length; offset += 500) {
    const { data, error } = await supabase.from("study_reading_plan_items")
      .insert(generated.slice(offset, offset + 500)).select("id");
    if (error) {
      if (insertedIds.length) {
        const { error: cleanupError } = await supabase.from("study_reading_plan_items").delete().in("id", insertedIds);
        if (cleanupError) throw new Error(`${error.message} Could not roll back partially generated plan items: ${cleanupError.message}`);
      }
      if (!id) {
        const { error: cleanupError } = await supabase.from("study_reading_plans").delete().eq("id", planId);
        if (cleanupError) throw new Error(`${error.message} Could not remove the incomplete plan: ${cleanupError.message}`);
      }
      return fail(error, "Could not generate the reading plan queue");
    }
    insertedIds.push(...(data || []).map((item) => item.id));
  }
  if (id) {
    const { data, error } = await supabase.from("study_reading_plans").update({
      ...planValues,
      status: previousStatus,
      user_id: planOwnerId,
      owner_email: planOwnerEmail,
    }).eq("id", id).select("id").maybeSingle();
    if (error || !data) {
      if (insertedIds.length) {
        const { error: cleanupError } = await supabase.from("study_reading_plan_items").delete().in("id", insertedIds);
        if (cleanupError) {
          const cause = error?.message || "Reading plan not found or you do not have permission to edit it.";
          throw new Error(`${cause} Could not roll back the generated queue: ${cleanupError.message}`);
        }
      }
      if (error) return fail(error, "Could not save book reading plan");
      throw new Error("Reading plan not found or you do not have permission to edit it.");
    }
    if (oldPendingIds.length) {
      const { error: deleteError } = await supabase.from("study_reading_plan_items").delete().in("id", oldPendingIds);
      if (deleteError) return fail(deleteError, "Could not replace the remaining reading plan queue");
    }
  }
  return { id: planId, status: id ? "updated" : "created" };
}

async function cancelBookReadingPlan(id) {
  if (!UUID_PATTERN.test(id)) throw new Error("Invalid book reading plan.");
  const { data, error } = await supabase.from("study_reading_plans").update({ status: "archived" })
    .eq("id", id).select("id").maybeSingle();
  if (error) return fail(error, "Could not archive book reading plan");
  if (!data) throw new Error("Reading plan not found or you do not have permission to access it.");
  return { status: "archived" };
}

async function continueBookReadingPlan(id, newStartDate = dateKeyInNewYork()) {
  if (!UUID_PATTERN.test(id)) throw new Error("Invalid book reading plan.");
  if (!validDateKey(newStartDate)) throw new Error("Enter a valid start date (YYYY-MM-DD).");
  const { data: plan, error: planError } = await supabase.from("study_reading_plans")
    .select("id,interval_days,start_date,weekdays,cadence_type,status")
    .eq("id", id)
    .maybeSingle();
  if (planError) return fail(planError, "Could not load book reading plan");
  if (!plan) throw new Error("Reading plan not found.");
  await reschedulePendingItems(id, plan, newStartDate);
  const { error } = await supabase.from("study_reading_plans").update({ status: "active", start_date: newStartDate }).eq("id", id);
  if (error) return fail(error, "Could not resume book reading plan");
  return { status: "active", plan_id: id, start_date: newStartDate };
}

async function reschedulePendingItems(planId, plan, startDate) {
  const { data: pending, error: pendingError } = await supabase.from("study_reading_plan_items")
    .select("id,sort_order").eq("plan_id", planId).eq("status", "pending").order("sort_order");
  if (pendingError) return fail(pendingError, "Could not load remaining plan items");
  for (let index = 0; index < pending.length; index += 1) {
    const scheduledDate = scheduledDateForIndex({ ...plan, start_date: startDate }, index);
    const { error } = await supabase.from("study_reading_plan_items")
      .update({ scheduled_date: scheduledDate }).eq("id", pending[index].id);
    if (error) return fail(error, "Could not reschedule remaining plan items");
  }
}

async function toggleBookReading(itemId, date) {
  if (!UUID_PATTERN.test(itemId) || !validDateKey(date)) throw new Error("Invalid reading plan item completion.");
  await currentUser();
  const { data, error } = await supabase.rpc("toggle_study_reading_plan_item", {
    p_item_id: itemId,
    p_read_date: date,
  });
  if (error) return fail(error, "Could not update reading plan item");
  return { completed: Boolean(data) };
}

async function saveChapterReading(payload) {
  const selections = normalizeChapterSelections(payload.chapter_selections);
  const readDate = String(payload.read_date || "");
  if (!validDateKey(readDate)) throw new Error("Choose a valid schedule date for this chapter reading.");
  const user = await currentUser();
  const { data, error } = await supabase.from("reading_logs")
    .insert({
      user_id: user.id,
      read_date: readDate,
      chapter_selections: selections,
      source_type: "manual",
      profile_id: activeReaderProfileId,
    })
    .select("id")
    .single();
  if (error) return fail(error, "Could not save your chapter reading");
  return {
    id: data.id,
    reference: formatChapterSelections(selections),
    read_date: readDate,
    chapter_count: selections.reduce((total, selection) => total + selection.end - selection.start + 1, 0),
  };
}

async function saveReadingLog(payload, id = "") {
  if (id && !UUID_PATTERN.test(id)) throw new Error("Invalid reading log.");
  const selections = normalizeChapterSelections(payload.chapter_selections);
  const readDate = String(payload.read_date || "");
  if (!validDateKey(readDate)) throw new Error("Choose a valid date for this reading log.");
  const user = await currentUser();
  const values = { read_date: readDate, chapter_selections: selections, profile_id: activeReaderProfileId };
  const query = id
    ? supabase.from("reading_logs").update(values).eq("id", id).eq("user_id", user.id).eq("source_type", "manual").select("id").maybeSingle()
    : supabase.from("reading_logs").insert({ ...values, user_id: user.id, source_type: "manual" }).select("id").single();
  const { data, error } = await query;
  if (error) return fail(error, "Could not save reading log");
  if (!data) throw new Error("Manual reading log not found or you do not have permission to edit it.");
  return { id: data.id, reference: formatChapterSelections(selections), read_date: readDate };
}

async function deleteReadingLog(id) {
  if (!UUID_PATTERN.test(id)) throw new Error("Invalid reading log.");
  const user = await currentUser();
  const { data: existing, error: findError } = await supabase.from("reading_logs")
    .select("legacy_source_id").eq("id", id).eq("user_id", user.id).eq("source_type", "manual").maybeSingle();
  if (findError) return fail(findError, "Could not load manual reading log");
  if (!existing) throw new Error("Manual reading log not found or you do not have permission to delete it.");
  if (existing.legacy_source_id) {
    const { error: legacyError } = await supabase.from("study_chapter_readings")
      .delete().eq("id", existing.legacy_source_id).eq("user_id", user.id);
    if (legacyError) return fail(legacyError, "Could not remove the legacy chapter reading");
  }
  const { data, error } = await supabase.from("reading_logs").delete()
    .eq("id", id).eq("user_id", user.id).eq("source_type", "manual").select("id").maybeSingle();
  if (error) return fail(error, "Could not delete reading log");
  if (!data) throw new Error("Manual reading log not found or you do not have permission to delete it.");
  return { status: "deleted" };
}

async function updateReadingPlanItem(id, payload) {
  if (!UUID_PATTERN.test(id)) throw new Error("Invalid reading plan item.");
  const values = {};
  if (payload.chapter_selections !== undefined) values.chapter_selections = normalizeChapterSelections(payload.chapter_selections);
  if (payload.scheduled_date !== undefined) {
    const scheduledDate = payload.scheduled_date || null;
    if (scheduledDate && !validDateKey(scheduledDate)) throw new Error("Choose a valid scheduled date.");
    values.scheduled_date = scheduledDate;
  }
  if (payload.notes !== undefined) values.notes = String(payload.notes || "").trim().slice(0, 1000) || null;
  if (payload.status !== undefined) {
    if (!["pending", "skipped"].includes(payload.status)) throw new Error("Use the checklist to mark an item completed.");
    values.status = payload.status;
  }
  if (payload.sort_order !== undefined) {
    const { data: current, error: currentError } = await supabase.from("study_reading_plan_items")
      .select("status").eq("id", id).maybeSingle();
    if (currentError) return fail(currentError, "Could not load reading plan item");
    if (!current) throw new Error("Reading plan item not found.");
    if (current.status !== "pending") throw new Error("Only pending reading plan items can be reordered.");
    const order = Number(payload.sort_order);
    if (!Number.isInteger(order) || order < 0) throw new Error("Choose a valid item order.");
    values.sort_order = order;
  }
  const { data, error } = await supabase.from("study_reading_plan_items").update(values)
    .eq("id", id).select("id,plan_id,status").maybeSingle();
  if (error) return fail(error, "Could not update reading plan item");
  if (!data) throw new Error("Reading plan item not found or you do not have permission to edit it.");
  if (payload.status !== undefined) await syncReadingPlanStatus(data.plan_id);
  return { id: data.id, plan_id: data.plan_id, status: data.status };
}

async function syncReadingPlanStatus(planId) {
  const [{ data: plan, error: planError }, { count, error: countError }] = await Promise.all([
    supabase.from("study_reading_plans").select("status").eq("id", planId).maybeSingle(),
    supabase.from("study_reading_plan_items")
      .select("id", { count: "exact", head: true }).eq("plan_id", planId).eq("status", "pending"),
  ]);
  if (planError) return fail(planError, "Could not load reading plan status");
  if (countError) return fail(countError, "Could not check remaining reading plan items");
  if (!plan || ["paused", "archived"].includes(plan.status)) return;
  const { error } = await supabase.from("study_reading_plans")
    .update({ status: count ? "active" : "completed" }).eq("id", planId);
  if (error) return fail(error, "Could not update reading plan status");
}

async function addReadingPlanItem(planId, payload) {
  if (!UUID_PATTERN.test(planId)) throw new Error("Invalid reading plan.");
  const selections = normalizeChapterSelections(payload.chapter_selections);
  const scheduledDate = payload.scheduled_date || null;
  if (scheduledDate && !validDateKey(scheduledDate)) throw new Error("Choose a valid scheduled date.");
  await currentUser();
  const { data: plan, error: planError } = await supabase.from("study_reading_plans")
    .select("id,user_id").eq("id", planId).maybeSingle();
  if (planError) return fail(planError, "Could not load reading plan");
  if (!plan) throw new Error("Reading plan not found.");
  const { data: rows, error: orderError } = await supabase.from("study_reading_plan_items")
    .select("sort_order").eq("plan_id", planId).order("sort_order", { ascending: false }).limit(1);
  if (orderError) return fail(orderError, "Could not load reading plan order");
  const { data, error } = await supabase.from("study_reading_plan_items").insert({
    plan_id: planId,
    user_id: plan.user_id,
    sort_order: rows?.length ? rows[0].sort_order + 1 : 0,
    scheduled_date: scheduledDate,
    chapter_selections: selections,
    status: "pending",
    notes: String(payload.notes || "").trim().slice(0, 1000) || null,
  }).select("id").single();
  if (error) return fail(error, "Could not add custom reading plan item");
  const { error: statusError } = await supabase.from("study_reading_plans")
    .update({ status: "active" }).eq("id", planId).eq("status", "completed");
  if (statusError) return fail(statusError, "Could not reactivate the extended reading plan");
  return { id: data.id, plan_id: planId };
}

async function deleteReadingPlanItem(id) {
  if (!UUID_PATTERN.test(id)) throw new Error("Invalid reading plan item.");
  const { data: item, error: itemError } = await supabase.from("study_reading_plan_items")
    .select("id,status,plan_id").eq("id", id).maybeSingle();
  if (itemError) return fail(itemError, "Could not load reading plan item");
  if (!item) throw new Error("Reading plan item not found.");
  if (item.status === "completed") throw new Error("Completed reading plan items cannot be removed.");
  const { data, error } = await supabase.from("study_reading_plan_items").delete()
    .eq("id", id).select("id").maybeSingle();
  if (error) return fail(error, "Could not delete reading plan item");
  if (!data) throw new Error("Reading plan item not found or you do not have permission to delete it.");
  await syncReadingPlanStatus(item.plan_id);
  return { status: "deleted" };
}

async function rescheduleReadingPlan(id, startDate) {
  if (!UUID_PATTERN.test(id) || !validDateKey(startDate)) throw new Error("Choose a valid plan and start date.");
  const { data: plan, error } = await supabase.from("study_reading_plans")
    .select("id,interval_days,start_date,weekdays,cadence_type").eq("id", id).maybeSingle();
  if (error) return fail(error, "Could not load reading plan");
  if (!plan) throw new Error("Reading plan not found.");
  await reschedulePendingItems(id, plan, startDate);
  const { error: updateError } = await supabase.from("study_reading_plans").update({ start_date: startDate }).eq("id", id);
  if (updateError) return fail(updateError, "Could not update reading plan start date");
  return { status: "rescheduled", start_date: startDate };
}

async function deleteBookReadingPlan(id) {
  if (!UUID_PATTERN.test(id)) throw new Error("Invalid book reading plan.");
  const { data: plan, error: planError } = await supabase.from("study_reading_plans")
    .select("id,status").eq("id", id).maybeSingle();
  if (planError) return fail(planError, "Could not load book reading plan");
  if (!plan) throw new Error("Reading plan not found or you do not have permission to delete it.");
  if (!["archived", "completed"].includes(plan.status)) {
    throw new Error("Only archived or completed reading plans can be deleted.");
  }

  const { data, error } = await supabase.from("study_reading_plans").delete().eq("id", id).select("id");
  if (error) return fail(error, "Could not delete book reading plan");
  if (!data?.length) throw new Error("Reading plan not found or you do not have permission to delete it.");
  return { status: "deleted" };
}

async function setReadingPlanStatus(id, status) {
  if (!UUID_PATTERN.test(id) || !["active", "paused", "archived"].includes(status)) {
    throw new Error("Choose a valid reading plan status.");
  }
  const { data, error } = await supabase.from("study_reading_plans").update({ status })
    .eq("id", id).select("id").maybeSingle();
  if (error) return fail(error, "Could not update reading plan status");
  if (!data) throw new Error("Reading plan not found or you do not have permission to edit it.");
  return { status };
}

// --- Recurring task schedules, completions, and ESV lookup ---
async function taskPlan(date = dateKeyInNewYork()) {
  if (!validDateKey(date)) throw new Error("Use a valid task date.");
  const user = await currentUser();
  let taskQuery = supabase.from("study_tasks")
    .select("id,task_type,title,details,weekdays,cadence_type,interval_days,start_date,status")
    .order("created_at");
  let completionQuery = supabase.from("study_task_completions").select("task_id").eq("completion_date", date);
  taskQuery = activeReaderProfileId ? taskQuery.eq("profile_id", activeReaderProfileId) : taskQuery.is("profile_id", null);
  completionQuery = activeReaderProfileId ? completionQuery.eq("profile_id", activeReaderProfileId) : completionQuery.is("profile_id", null);
  const [{ data: tasks, error: taskError }, { data: completed, error: completionError }] = await Promise.all([taskQuery, completionQuery]);
  if (taskError) return fail(taskError, "Could not load recurring tasks");
  if (completionError) return fail(completionError, "Could not load task completions");
  const done = new Set((completed || []).map((item) => item.task_id));
  const scheduledTasks = (tasks || []).map((task) => ({
    ...task,
    cadence_type: task.cadence_type || "weekdays",
    interval_days: task.interval_days || 1,
    status: task.status || "active",
    scheduled: (task.status || "active") === "active" && readingIndexForDate(task, date) >= 0,
    completed: done.has(task.id),
  }));
  return {
    tasks: scheduledTasks,
    items: scheduledTasks.filter((task) => task.scheduled),
    date,
    user_id: user.id,
  };
}

async function saveTask(payload, id = "") {
  const user = await currentUser();
  const cadenceType = payload.cadence_type;
  const intervalDays = Number(payload.interval_days);
  const startDate = String(payload.start_date || "");
  const weekdays = cadenceType === "weekdays"
    ? [...new Set((Array.isArray(payload.weekdays) ? payload.weekdays : []).map(Number))].sort()
    : null;
  const title = String(payload.title || "").trim();
  if (!TASK_TYPES.includes(payload.task_type) || !title || title.length > 120
    || !["interval", "weekdays"].includes(cadenceType)
    || (cadenceType === "interval" && (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365))
    || (cadenceType === "weekdays" && (!weekdays.length || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)))
    || !validDateKey(startDate)) {
    throw new Error("Choose a task type, name, valid recurrence, and start date.");
  }
  const values = {
    user_id: user.id,
    profile_id: activeReaderProfileId,
    task_type: payload.task_type,
    title,
    details: String(payload.details || "").trim().slice(0, 300),
    cadence_type: cadenceType,
    interval_days: intervalDays,
    weekdays,
    start_date: startDate,
  };
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
  let taskTitle = "";
  if (!existing) {
    const { data: task, error: taskError } = await supabase.from("study_tasks")
      .select("title")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError) return fail(taskError, "Could not load task name");
    if (!task) throw new Error("Task not found or you do not have permission to access it.");
    taskTitle = task.title;
  }
  const query = existing
    ? supabase.from("study_task_completions").delete().eq("task_id", taskId).eq("completion_date", date)
    : supabase.from("study_task_completions").insert({
      task_id: taskId,
      task_title: taskTitle,
      user_id: user.id,
      profile_id: activeReaderProfileId,
      completion_date: date,
    });
  const { error } = await query;
  if (error) return fail(error, "Could not update task completion");
  return { completed: !existing };
}

async function deleteTask(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid recurring task.");
  const { data, error } = await supabase.from("study_tasks").update({ status: "archived" }).eq("id", id).select("id");
  if (error) return fail(error, "Could not archive recurring task");
  if (!data?.length) throw new Error("Task not found or you do not have permission to delete it.");
  return { status: "archived" };
}

async function setTaskStatus(id, status) {
  if (!UUID_PATTERN.test(id) || !["active", "paused", "archived"].includes(status)) {
    throw new Error("Choose a valid task status.");
  }
  const { data, error } = await supabase.from("study_tasks").update({ status }).eq("id", id).select("id").maybeSingle();
  if (error) return fail(error, "Could not update task status");
  if (!data) throw new Error("Task not found or you do not have permission to edit it.");
  return { status };
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
  if (path === "/api/reader-profiles" && method === "GET") return readerProfiles();
  if (path === "/api/reader-profiles" && method === "POST") return createReaderProfile(JSON.parse(options.body));
  const readerProfile = path.match(/^\/api\/reader-profiles\/([0-9a-f-]+)$/i);
  if (readerProfile && method === "PUT") return updateReaderProfile(readerProfile[1], JSON.parse(options.body));
  if (readerProfile && method === "DELETE") return deleteReaderProfile(readerProfile[1]);
  if (path === "/api/folders" && method === "GET") return listFolders();
  if (path === "/api/search/notes" && method === "GET") return searchNotes(parsed.searchParams);
  if (path === "/api/book-reading-plans" && method === "GET") return bookReadingPlans(parsed.searchParams.get("date") || undefined);
  if (path === "/api/book-reading-plans" && method === "POST") return saveBookReadingPlan(JSON.parse(options.body));
  if (path === "/api/chapter-readings" && method === "POST") return saveChapterReading(JSON.parse(options.body));
  if (path === "/api/reading-logs" && method === "GET") {
    return fetchReadingLogs(parsed.searchParams.get("date") || "");
  }
  if (path === "/api/reading-logs" && method === "POST") return saveReadingLog(JSON.parse(options.body));
  if (path === "/api/reading-status" && method === "GET") return readingDayStatus(parsed.searchParams.get("date") || undefined);
  if (path === "/api/reading-statistics" && method === "GET") return readingStatistics();
  if (path === "/api/tasks" && method === "GET") return taskPlan(parsed.searchParams.get("date") || undefined);
  if (path === "/api/tasks" && method === "POST") return saveTask(JSON.parse(options.body));
  const readingLog = path.match(/^\/api\/reading-logs\/([0-9a-f-]+)$/i);
  if (readingLog && method === "PUT") return saveReadingLog(JSON.parse(options.body), readingLog[1]);
  if (readingLog && method === "DELETE") return deleteReadingLog(readingLog[1]);
  const planItemToggle = path.match(/^\/api\/reading-plan-items\/([0-9a-f-]+)\/toggle$/i);
  if (planItemToggle && method === "POST") return toggleBookReading(planItemToggle[1], parsed.searchParams.get("date") || "");
  const planItem = path.match(/^\/api\/reading-plan-items\/([0-9a-f-]+)$/i);
  if (planItem && method === "PUT") return updateReadingPlanItem(planItem[1], JSON.parse(options.body));
  if (planItem && method === "DELETE") return deleteReadingPlanItem(planItem[1]);
  const planItems = path.match(/^\/api\/book-reading-plans\/([0-9a-f-]+)\/items$/i);
  if (planItems && method === "POST") return addReadingPlanItem(planItems[1], JSON.parse(options.body));
  const planReschedule = path.match(/^\/api\/book-reading-plans\/([0-9a-f-]+)\/reschedule$/i);
  if (planReschedule && method === "POST") return rescheduleReadingPlan(planReschedule[1], JSON.parse(options.body).start_date);
  const planStatus = path.match(/^\/api\/book-reading-plans\/([0-9a-f-]+)\/status$/i);
  if (planStatus && method === "POST") return setReadingPlanStatus(planStatus[1], JSON.parse(options.body).status);
  const bookPlanCancel = path.match(/^\/api\/book-reading-plans\/([0-9a-f-]+)\/cancel$/i);
  if (bookPlanCancel && method === "POST") return cancelBookReadingPlan(bookPlanCancel[1]);
  const bookPlanContinue = path.match(/^\/api\/book-reading-plans\/([0-9a-f-]+)\/continue$/i);
  if (bookPlanContinue && method === "POST") {
    const body = options.body ? JSON.parse(options.body) : {};
    return continueBookReadingPlan(bookPlanContinue[1], body.start_date);
  }
  const bookPlan = path.match(/^\/api\/book-reading-plans\/([0-9a-f-]+)$/i);
  if (bookPlan && method === "PUT") return saveBookReadingPlan(JSON.parse(options.body), bookPlan[1]);
  if (bookPlan && method === "DELETE") return deleteBookReadingPlan(bookPlan[1]);
  const taskToggle = path.match(/^\/api\/tasks\/([0-9a-f-]+)\/toggle$/i);
  if (taskToggle && method === "POST") return toggleTask(taskToggle[1], parsed.searchParams.get("date") || "");
  const task = path.match(/^\/api\/tasks\/([0-9a-f-]+)$/i);
  if (task && method === "PUT") return saveTask(JSON.parse(options.body), task[1]);
  if (task && method === "DELETE") return deleteTask(task[1]);
  const taskStatus = path.match(/^\/api\/tasks\/([0-9a-f-]+)\/status$/i);
  if (taskStatus && method === "POST") return setTaskStatus(taskStatus[1], JSON.parse(options.body).status);
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
