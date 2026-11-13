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

  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  if (destination.value === "existing") {
    formData.append("target_note", existingNote.value);
  }
  uploadButton.disabled = true;
  uploadButton.textContent = "Uploading…";
  setStatus(`Transcribing and saving ${files.length} image(s)…`);

  try {
    const result = await apiRequest("/api/uploads", { method: "POST", body: formData });
    const summary = result.items.map((item) => {
      const provider = item.transcription_provider === "gemini" ? "Gemini" : "browser OCR";
      const transcription = item.transcription_available ? provider : `${provider}, no text detected`;
      const notePaths = item.note_paths?.length ? item.note_paths.join(", ") : item.note_path;
      return `${item.original_filename} → ${notePaths} (${transcription})`;
    });
    setStatus(summary.join(" | "));
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
  setStatus(`Could not check your sign-in: ${sessionError.message}`, true);
} else if (!sessionData.session) {
  window.location.replace("./index.html");
} else {
  loadExistingNotes().catch((error) => setStatus(error.message, true));
}

window.addEventListener("beforeunload", () => {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
});
