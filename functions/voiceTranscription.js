const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");

const app = getApps().length ? getApp() : initializeApp();
const storage = getStorage(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const TRANSCRIPTION_MODEL = "gpt-4o-transcribe";

function audioFileName(storagePath, contentType) {
  const existingName = String(storagePath || "voice-note").split("/").pop();
  if (existingName?.includes(".")) return existingName;
  if (contentType?.includes("webm")) return `${existingName || "voice-note"}.webm`;
  if (contentType?.includes("mpeg")) return `${existingName || "voice-note"}.mp3`;
  return `${existingName || "voice-note"}.m4a`;
}

async function requestTranscription(audioBuffer, fileName, contentType) {
  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: contentType || "audio/mp4" }), fileName);
  form.append("model", TRANSCRIPTION_MODEL);
  form.append("response_format", "json");
  form.append(
    "prompt",
    "Nota técnica de servicio de aire acondicionado de DEMAC. Conserva marcas, BTU, PSI, voltajes, refrigerantes, nombres de piezas y recomendaciones. El técnico puede hablar español, inglés o papiamento.",
  );

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiApiKey.value()}` },
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
  if (!transcript) throw new Error("OpenAI no devolvió texto para la nota de voz.");
  return transcript;
}

/**
 * Transcribes newly created work-order voice evidence on the server. The
 * OpenAI key remains in Firebase Secret Manager and is never sent to the app.
 */
exports.transcribeWorkOrderVoiceNote = onDocumentCreated(
  {
    document: "workOrderEvidence/{evidenceId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 180,
    secrets: [openAiApiKey],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const original = snapshot.data() || {};
    if (original.mediaKind !== "audio" || !original.storagePath) return;

    const evidenceRef = snapshot.ref;
    const current = (await evidenceRef.get()).data() || {};
    if (current.transcriptionStatus === "completed" && current.transcript) return;

    try {
      await evidenceRef.set({
        transcriptionStatus: "processing",
        transcriptionError: FieldValue.delete(),
        transcriptionStartedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const file = storage.bucket().file(original.storagePath);
      const [metadata, contents] = await Promise.all([file.getMetadata(), file.download()]);
      const contentType = original.contentType || metadata?.[0]?.contentType || "audio/mp4";
      const transcript = await requestTranscription(
        contents[0],
        audioFileName(original.storagePath, contentType),
        contentType,
      );

      await evidenceRef.set({
        transcript,
        transcriptionStatus: "completed",
        transcriptionModel: TRANSCRIPTION_MODEL,
        transcriptionError: FieldValue.delete(),
        transcribedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      logger.info("Work-order voice note transcribed.", {
        evidenceId: snapshot.id,
        workOrderId: original.workOrderId,
      });
    } catch (error) {
      logger.error("Could not transcribe work-order voice note.", error);
      await evidenceRef.set({
        transcriptionStatus: "failed",
        transcriptionError: error?.message || "Unknown transcription error",
        transcriptionModel: TRANSCRIPTION_MODEL,
        transcriptionFailedAt: FieldValue.serverTimestamp(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      throw error;
    }
  },
);
