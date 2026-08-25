const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const {
  DEFAULT_TRANSCRIPTION_MODEL,
  transcribeStoredAudio,
} = require("./demacTranscriptionService");

const app = getApps().length ? getApp() : initializeApp();
const storage = getStorage(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const TRANSCRIPTION_MODEL = DEFAULT_TRANSCRIPTION_MODEL;
const TECHNICIAN_TRANSCRIPTION_PROMPT = [
  "Nota técnica de servicio de aire acondicionado de DEMAC.",
  "Conserva marcas, BTU, PSI, voltajes, refrigerantes, nombres de piezas y recomendaciones.",
  "El técnico puede hablar español, inglés o papiamento.",
].join(" ");

/**
 * Transcribes newly created work-order voice evidence on the server. The
 * OpenAI key remains in Firebase Secret Manager and is never sent to the app.
 * Audio retrieval and OpenAI invocation are owned by the shared DEMAC
 * transcription service so customer communication voice can reuse the same
 * infrastructure without creating a second transcription authority.
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

      const result = await transcribeStoredAudio({
        storage,
        storagePath: original.storagePath,
        contentType: original.contentType,
        apiKey: openAiApiKey.value(),
        model: TRANSCRIPTION_MODEL,
        prompt: TECHNICIAN_TRANSCRIPTION_PROMPT,
      });

      await evidenceRef.set({
        transcript: result.transcript,
        transcriptionStatus: "completed",
        transcriptionModel: result.model,
        transcriptionServiceVersion: result.serviceVersion,
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

module.exports.TECHNICIAN_TRANSCRIPTION_PROMPT = TECHNICIAN_TRANSCRIPTION_PROMPT;
module.exports.TRANSCRIPTION_MODEL = TRANSCRIPTION_MODEL;
