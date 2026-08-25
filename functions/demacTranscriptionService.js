const { cleanText } = require("./bookingSchedulingPrimitives");

const DEMAC_TRANSCRIPTION_SERVICE_VERSION = 1;
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
const DEFAULT_CONTENT_TYPE = "audio/mp4";

function audioFileName(storagePath, contentType) {
  const existingName = String(storagePath || "voice-note").split("/").pop();
  if (existingName?.includes(".")) return existingName;
  const mime = String(contentType || "").toLowerCase();
  if (mime.includes("webm")) return `${existingName || "voice-note"}.webm`;
  if (mime.includes("mpeg") || mime.includes("mp3")) return `${existingName || "voice-note"}.mp3`;
  if (mime.includes("ogg") || mime.includes("opus")) return `${existingName || "voice-note"}.ogg`;
  if (mime.includes("wav")) return `${existingName || "voice-note"}.wav`;
  return `${existingName || "voice-note"}.m4a`;
}

function transcriptionPrompt(value) {
  return cleanText(value, 2_000);
}

async function requestTranscription({
  audioBuffer,
  fileName,
  contentType = DEFAULT_CONTENT_TYPE,
  apiKey,
  model = DEFAULT_TRANSCRIPTION_MODEL,
  prompt = "",
  fetchImpl = fetch,
} = {}) {
  if (!Buffer.isBuffer(audioBuffer) || !audioBuffer.length) {
    throw new Error("A non-empty audio buffer is required for transcription.");
  }
  if (!cleanText(apiKey, 8_000)) throw new Error("OpenAI API key is required for transcription.");
  const normalizedModel = cleanText(model, 120) || DEFAULT_TRANSCRIPTION_MODEL;
  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: contentType || DEFAULT_CONTENT_TYPE }), fileName || "voice-note.m4a");
  form.append("model", normalizedModel);
  form.append("response_format", "json");
  const normalizedPrompt = transcriptionPrompt(prompt);
  if (normalizedPrompt) form.append("prompt", normalizedPrompt);

  const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI returned HTTP ${response.status}`;
    const error = new Error(message);
    error.code = payload?.error?.code || response.status;
    throw error;
  }
  const transcript = String(payload?.text || "").trim();
  if (!transcript) throw new Error("OpenAI returned an empty transcription.");
  return {
    transcript,
    model: normalizedModel,
    serviceVersion: DEMAC_TRANSCRIPTION_SERVICE_VERSION,
  };
}

async function loadStorageAudio({ storage, storagePath, contentType } = {}) {
  if (!storage || typeof storage.bucket !== "function") throw new Error("Firebase Storage is required for transcription.");
  const normalizedPath = cleanText(storagePath, 1_500);
  if (!normalizedPath) throw new Error("Audio storagePath is required for transcription.");
  const file = storage.bucket().file(normalizedPath);
  const [metadata, contents] = await Promise.all([file.getMetadata(), file.download()]);
  const bytes = contents?.[0];
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error("Stored audio is empty.");
  const resolvedContentType = cleanText(contentType, 160)
    || cleanText(metadata?.[0]?.contentType, 160)
    || DEFAULT_CONTENT_TYPE;
  return {
    audioBuffer: bytes,
    contentType: resolvedContentType,
    fileName: audioFileName(normalizedPath, resolvedContentType),
    storagePath: normalizedPath,
    size: bytes.length,
  };
}

async function transcribeStoredAudio({
  storage,
  storagePath,
  contentType,
  apiKey,
  model = DEFAULT_TRANSCRIPTION_MODEL,
  prompt = "",
  fetchImpl = fetch,
} = {}) {
  const audio = await loadStorageAudio({ storage, storagePath, contentType });
  const result = await requestTranscription({
    audioBuffer: audio.audioBuffer,
    fileName: audio.fileName,
    contentType: audio.contentType,
    apiKey,
    model,
    prompt,
    fetchImpl,
  });
  return { ...result, ...audio };
}

module.exports = {
  DEFAULT_CONTENT_TYPE,
  DEFAULT_TRANSCRIPTION_MODEL,
  DEMAC_TRANSCRIPTION_SERVICE_VERSION,
  audioFileName,
  loadStorageAudio,
  requestTranscription,
  transcribeStoredAudio,
  transcriptionPrompt,
};
