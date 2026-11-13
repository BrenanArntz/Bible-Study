import { supabase } from "./supabase-client.js";

const NOTE_CATEGORIES = ["exegesis", "topics", "church-history"];
const FOLDER_NAMES = {
  exegesis: "Exegesis",
  topics: "Topics",
  "church-history": "Church History",
  daily: "Daily",
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_LINK = /!\[([^\]]*)\]\(([^)]+)\)/g;
const bibleBooks = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges",
  "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles",
  "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
  "Ecclesiastes", "Song of Solomon", "Song of Songs", "Isaiah", "Jeremiah",
  "Lamentations",
  "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
  "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew",
  "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians",
  "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians",
  "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews",
  "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude",
  "Revelation",
].sort((left, right) => right.length - left.length);
const bibleBookPattern = bibleBooks
  .map((book) => book.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const bibleReferencePattern = new RegExp(`\\b(${bibleBookPattern})(?![a-z])\\s+(\\d{1,3})`, "i");

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
    reading: metadata.reading ?? metadata.readings ?? null,
    completed: metadata.completed === true,
    updated_at: modifiedAt,
  };
}

async function allNotes() {
  const { data, error } = await supabase
    .from("study_notes")
    .select("id,user_id,path,content,title,category,note_date,identifier,reference,reading,completed,created_at,updated_at")
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
  return { path: data.path, status: "saved" };
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

function addVerseReferences(markdown, title, reference) {
  const passagePattern = /\b(Ephesians|Eph\.?)[\s]+(\d{1,3})(?:\s*[,/&]\s*(\d{1,3}))*/i;
  const passage = [reference, title].map((value) => String(value || "").match(passagePattern)).find(Boolean);
  if (!passage) return markdown;

  const book = "Ephesians";
  let chapter = Number(passage[2]);
  const chapterHeading = new RegExp(
    `^\\s*(?:#{1,6}\\s*)?${book.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(\\d{1,3})\\s*:?\\s*$`,
    "i",
  );
  return markdown.split(/\r?\n/).map((line) => {
    const heading = line.match(chapterHeading)
      || line.match(/^\s*(?:#{1,6}\s*)?chapter\s+(\d{1,3})\s*:?\s*$/i);
    if (heading) {
      chapter = Number(heading[1]);
      return line;
    }

    const verse = line.match(/^(\s*)(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?(\s+\S.*)$/);
    if (!verse) return line;
    const range = verse[3] ? `-${verse[3]}` : "";
    return `${verse[1]}${book} ${chapter}:${verse[2]}${range}${verse[4]}`;
  }).join("\n");
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
  const transcription = addVerseReferences(markdown.trim(), title, reference)
    || "No readable text was detected.";
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

function readingPlan() {
  return allNotes().then((notes) => ({
    items: notes
      .filter((note) => note.category === "daily" && note.note_date)
      .sort((left, right) => left.note_date.localeCompare(right.note_date))
      .map((note) => ({
        filename: note.path.split("/").at(-1),
        path: note.path,
        date: note.note_date,
        reading: note.reading || "",
        completed: note.completed,
      })),
  }));
}

async function toggleReading(filename) {
  if (filename.includes("/") || filename.includes("\\") || !filename.endsWith(".md")) {
    throw new Error("Provide a daily note filename ending in .md.");
  }
  const path = `daily/${filename}`;
  const note = await noteByPath(path);
  const frontmatter = note.content.match(/^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/);
  if (!frontmatter) throw new Error("Daily note must have YAML frontmatter.");
  const completed = !note.completed;
  const fields = frontmatter[1];
  const updatedFields = /^completed\s*:/m.test(fields)
    ? fields.replace(/^completed\s*:.*$/m, `completed: ${completed}`)
    : `${fields}\ncompleted: ${completed}`;
  const content = note.content.replace(frontmatter[0], `---\n${updatedFields}\n---`);
  await putContent(path, content);
  return { filename, completed, path };
}

async function esvLookup(reference) {
  const { data, error } = await supabase.functions.invoke("esv-lookup", { body: { q: reference } });
  if (error) return fail(error, "Passage lookup failed");
  return data;
}

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

function decodePath(value) {
  return value.split("/").map((part) => decodeURIComponent(part)).join("/");
}

async function importNotes(fileList) {
  const files = [...fileList];
  const markdownFiles = files.filter((file) => /\.md$/i.test(file.name));
  const imageFiles = files.filter((file) => file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff?|heic|heif)$/i.test(file.name));
  if (!markdownFiles.length) throw new Error("No Markdown notes were selected.");
  const user = await currentUser();
  const localImageMap = new Map();
  const uploadedStoragePaths = [];
  const existing = await allNotes();
  const existingPaths = new Set(existing.map((note) => note.path));
  const rows = [];
  let skipped = 0;
  for (const file of markdownFiles) {
    const relative = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
    const parts = relative.split("/");
    if (parts[0].toLowerCase() === "notes") parts.shift();
    const path = safePath(parts.join("/"));
    if (existingPaths.has(path)) {
      skipped += 1;
      continue;
    }
    rows.push({ path, content: await file.text() });
    existingPaths.add(path);
  }
  if (!rows.length) return { imported: 0, skipped, images: 0 };

  const insertedPaths = [];
  try {
    for (const file of imageFiles) {
      if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} is larger than 25 MB.`);
      const filename = makeImageName(file);
      const storagePath = `${user.id}/${filename}`;
      const { error } = await supabase.storage.from("study-images").upload(storagePath, file, {
        contentType: imageContentType(file),
        upsert: false,
      });
      if (error) await fail(error, `Could not import ${file.name}`);
      uploadedStoragePaths.push(storagePath);
      localImageMap.set(file.name, filename);
    }

    for (const row of rows) {
      let content = row.content;
      content = content.replace(IMAGE_LINK, (whole, alt, destination) => {
        const match = destination.match(/(?:^|\/)_uploads\/([^/]+)$/);
        const replacement = match && localImageMap.get(match[1]);
        return replacement
          ? `![${alt}](${destination.slice(0, -match[1].length)}${replacement})`
          : whole;
      });
      Object.assign(row, noteFields(row.path, content), { user_id: user.id });
    }
    for (let offset = 0; offset < rows.length; offset += 100) {
      const batch = rows.slice(offset, offset + 100);
      const { error } = await supabase.from("study_notes").insert(batch);
      if (error) await fail(error, "Could not import Markdown notes");
      insertedPaths.push(...batch.map((note) => note.path));
    }
  } catch (error) {
    if (insertedPaths.length) {
      const { error: rollbackError } = await supabase.from("study_notes").delete().in("path", insertedPaths);
      if (rollbackError) throw new Error(`${error.message} Also, rollback of partially imported notes failed: ${rollbackError.message}`);
    }
    if (uploadedStoragePaths.length) {
      try {
        await storageDelete(uploadedStoragePaths);
      } catch (cleanupError) {
        throw new Error(`${error.message} Also, cleanup of uploaded images failed: ${cleanupError.message}`);
      }
    }
    throw error;
  }
  return { imported: rows.length, skipped, images: localImageMap.size };
}

export async function apiRequest(url, options = {}) {
  const parsed = new URL(url, window.location.origin);
  const method = (options.method || "GET").toUpperCase();
  const path = parsed.pathname;
  if (path === "/api/folders" && method === "GET") return listFolders();
  if (path === "/api/search/notes" && method === "GET") return searchNotes(parsed.searchParams);
  if (path === "/api/reading-plan" && method === "GET") return readingPlan();
  if (path === "/api/uploads" && method === "POST") return uploadBatch(options.body);
  if (path === "/api/esv" && method === "GET") return esvLookup(parsed.searchParams.get("q") || "");
  const toggle = path.match(/^\/api\/reading-plan\/([^/]+)\/toggle$/);
  if (toggle && method === "POST") return toggleReading(decodeURIComponent(toggle[1]));
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
      const { data, error } = await supabase.from("study_notes").delete().eq("path", safePath(notePath)).select("path");
      if (error) return fail(error, "Could not delete note");
      if (!data?.length) throw new Error("Note not found or you do not have permission to delete it.");
      return { path: notePath, status: "deleted" };
    }
  }
  if (path === "/api/import-notes" && method === "POST") return importNotes(options.body);
  throw new Error(`Unsupported app request: ${method} ${path}`);
}
