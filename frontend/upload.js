import { apiRequest } from "./data.js";
import { supabase } from "./supabase-client.js";

const form = document.querySelector("#upload-form");
const destination = document.querySelector("#upload-destination");
const existingNoteField = document.querySelector("#existing-note-field");
const existingNote = document.querySelector("#existing-note");
const cameraPhoto = document.querySelector("#camera-photo");
const galleryPhotos = document.querySelector("#gallery-photos");
const previews = document.querySelector("#photo-previews");
const uploadButton = document.querySelector("#upload-button");
const statusMessage = document.querySelector("#upload-status");
let previewUrls = [];
let selectedFiles = [];

function lastUploadedNote() {
  try {
    return JSON.parse(sessionStorage.getItem("scripture-study:last-uploaded-note") || "null");
  } catch {
    return null;
  }
}

function renderLastUploadOption() {
  const last = lastUploadedNote();
  const option = document.querySelector("#last-upload-option");
  if (!last?.path) {
    option.hidden = true;
    return;
  }
  option.hidden = false;
  option.textContent = `Append to last uploaded note: ${last.title}`;
  option.value = "last";
}

renderLastUploadOption();

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function clearPreviews() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
  previews.replaceChildren();
}

function renderPreviews() {
  clearPreviews();
  selectedFiles.forEach((file) => {
    const url = URL.createObjectURL(file);
    previewUrls.push(url);
    const image = document.createElement("img");
    image.className = "upload-preview";
    image.src = url;
    image.alt = `Preview of ${file.name}`;
    image.title = file.name;
    previews.append(image);
  });
}

function addSelectedPhotos(input) {
  const addedFiles = Array.from(input.files || []);
  if (addedFiles.length) {
    selectedFiles.push(...addedFiles);
    renderPreviews();
    setStatus(`${selectedFiles.length} image(s) selected.`);
  }
  input.value = "";
}

async function loadExistingNotes() {
  const payload = await apiRequest("/api/folders");
  existingNote.replaceChildren(new Option("Choose a note", ""));
  payload.folders.forEach((folder) => {
    if (!folder.files.length) return;
    const group = document.createElement("optgroup");
    group.label = folder.name;
    folder.files.forEach((note) => {
      group.append(new Option(note.name, note.path));
    });
    existingNote.append(group);
  });
}

destination.addEventListener("change", () => {
  const selectingExisting = destination.value === "existing";
  existingNoteField.hidden = !selectingExisting;
  existingNote.required = selectingExisting;
});

cameraPhoto.addEventListener("change", () => addSelectedPhotos(cameraPhoto));
galleryPhotos.addEventListener("change", () => addSelectedPhotos(galleryPhotos));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = [...selectedFiles];
  if (!files.length) {
    setStatus("Choose or take at least one photo first.", true);
    return;
  }
  if (destination.value === "existing" && !existingNote.value) {
    setStatus("Choose the note to add these images to.", true);
    return;
  }

  const targetNote = destination.value === "existing"
    ? existingNote.value
    : destination.value === "last"
      ? lastUploadedNote()?.path
      : "";
  uploadButton.disabled = true;
  uploadButton.textContent = "Uploading…";
  setStatus(`Transcribing and saving ${files.length} image(s)…`);

  try {
    const completed = [];
    for (let index = 0; index < files.length; index += 1) {
      setStatus(`Transcribing page ${index + 1} of ${files.length}…`);
      const formData = new FormData();
      formData.append("files", files[index]);
      if (targetNote) formData.append("target_note", targetNote);
      const result = await apiRequest("/api/uploads", { method: "POST", body: formData });
      completed.push(...(result.items || []));
      if (index === 0 && !targetNote) {
        const firstPath = completed[0]?.note_path;
        if (firstPath) sessionStorage.setItem("scripture-study:current-upload", JSON.stringify({
          path: firstPath,
          title: completed[0]?.note_title || "",
        }));
      }
    }

    const uniquePaths = [...new Map(completed.flatMap((item) => (
      item.note_paths?.length ? item.note_paths : [item.note_path]
    ).filter(Boolean).map((path) => [path, item]))).entries()];
    statusMessage.replaceChildren();
    const intro = document.createTextNode(`Uploaded ${files.length} page(s). `);
    statusMessage.append(intro);
    uniquePaths.forEach(([path, item], index) => {
      if (index) statusMessage.append(document.createTextNode(" "));
      const link = document.createElement("a");
      link.className = "upload-open-link";
      link.href = `./index.html#note=${encodeURIComponent(path)}`;
      link.textContent = `Open ${item.note_title || path.split("/").at(-1).replace(/\.md$/i, "")}`;
      statusMessage.append(link);
    });
    renderLastUploadOption();
    form.reset();
    selectedFiles = [];
    existingNoteField.hidden = true;
    existingNote.required = false;
    clearPreviews();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    uploadButton.disabled = false;
    uploadButton.textContent = "Upload photo";
  }
});

const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
if (sessionError) {
  window.location.replace("./index.html");
} else if (!sessionData.session) {
  window.location.replace("./index.html");
} else {
  document.querySelector(".upload-shell").hidden = false;
  loadExistingNotes().catch((error) => setStatus(error.message, true));
}

window.addEventListener("beforeunload", () => {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
