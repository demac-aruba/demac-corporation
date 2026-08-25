const crypto = require("node:crypto");
const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { cleanText } = require("./bookingSchedulingPrimitives");
const {
  MAYA_SETTINGS_COLLECTION,
  MAYA_SETTINGS_DOCUMENT,
} = require("./demacCustomerAgentReplyPolicy");
const {
  COMMUNICATION_SETTINGS_COLLECTION,
  COMMUNICATION_SETTINGS_DOCUMENT,
} = require("./demacCommunicationIdentity");
const { customerVoiceEligibilityDecision, customerVoiceMedia, timestampMillis } = require("./demacCustomerVoiceEligibility");
const {
  DEFAULT_TRANSCRIPTION_MODEL,
  firebaseStoragePathFromMediaUrl,
  transcribeStoredAudio,
} = require("./demacTranscriptionService");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const storage = getStorage(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const TRANSCRIPTION_MODEL = DEFAULT_TRANSCRIPTION_MODEL;
const DEFAULT_CUSTOMER_VOICE_MAX_ATTEMPTS = 3;
const MAX_CUSTOMER_VOICE_ATTEMPTS = 10;
const CUSTOMER_TRANSCRIPTION_PROMPT = [
  "Transcribe the customer exactly in the language spoken; do not translate.",
  "The customer may speak Aruba Papiamento, Spanish, or English.",
  "Preserve dates, times, phone numbers, addresses, quantities, BTU, PSI, prices, and appointment references as faithfully as possible.",
  "Do not silently normalize uncertain critical values.",
].join(" ");
const TECHNICIAN_TRANSCRIPTION_PROMPT = [
  "Nota técnica de servicio de aire acondicionado de DEMAC.",
  "Conserva marcas, BTU, PSI, voltajes, refrigerantes, nombres de piezas y recomendaciones.",
  "El técnico puede hablar español, inglés o papiamento.",
].join(" ");

function customerVoiceStoragePath(message = {}) {
  const direct = cleanText(message.mediaStoragePath || message.storagePath, 1_500);
  if (direct) return direct;
  const bucketName = cleanText(storage.bucket().name, 300);
  return firebaseStoragePathFromMediaUrl(message.mediaUrl, bucketName);
}

function sameEligibilityValue(field, beforeValue, afterValue) {
  if (["firstReceivedAt", "firstIngestedAt"].includes(field)) {
    return timestampMillis(beforeValue) === timestampMillis(afterValue);
  }
  return beforeValue === afterValue;
}

function customerVoiceUpdateMayChangeEligibility(before = {}, after = {}) {
  if (!customerVoiceMedia(after)) return false;
  const fields = [
    "communicationAccountId",
    "firstReceivedAt",
    "firstIngestedAt",
    "mediaStoragePath",
    "mediaUrl",
    "mediaSize",
    "mediaDuration",
    "transcriptionStatus",
    "transcriptionVersion",
  ];
  return fields.some((field) => !sameEligibilityValue(field, before[field], after[field]));
}

async function customerVoiceSettings() {
  const [policySnapshot, communicationSnapshot] = await Promise.all([
    db.collection(MAYA_SETTINGS_COLLECTION).doc(MAYA_SETTINGS_DOCUMENT).get(),
    db.collection(COMMUNICATION_SETTINGS_COLLECTION).doc(COMMUNICATION_SETTINGS_DOCUMENT).get(),
  ]);
  return {
    settings: policySnapshot.exists ? policySnapshot.data() || {} : {},
    communicationSettings: communicationSnapshot.exists ? communicationSnapshot.data() || {} : {},
  };
}

function processingLeaseActive(message = {}, version, now = Date.now()) {
  if (message.transcriptionStatus !== "processing" || cleanText(message.transcriptionVersion, 80) !== version) return false;
  const started = timestampMillis(message.transcriptionStartedAt);
  return Boolean(started && started + 10 * 60 * 1000 > now);
}

function configuredVoiceMaxAttempts(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_CUSTOMER_VOICE_MAX_ATTEMPTS;
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 1 && normalized <= MAX_CUSTOMER_VOICE_ATTEMPTS
    ? normalized
    : DEFAULT_CUSTOMER_VOICE_MAX_ATTEMPTS;
}

function safeTranscriptionAttempts(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : 0;
}

async function claimCustomerVoiceTranscription(messageRef, settings, communicationSettings = {}) {
  const claimId = crypto.randomUUID();
  let result = { claimed: false, reason: "unknown" };
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(messageRef);
    if (!snapshot.exists) {
      result = { claimed: false, reason: "message-not-found" };
      return;
    }
    const current = { id: snapshot.id, ...snapshot.data() };
    const decision = customerVoiceEligibilityDecision({ message: current, settings, communicationSettings });
    if (!decision.eligible) {
      result = { claimed: false, reason: decision.reason, decision };
      transaction.set(messageRef, {
        transcriptionEligibilityStatus: decision.reason,
        transcriptionEligibilityCheckedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }
    if (processingLeaseActive(current, decision.transcriptionVersion)) {
      result = { claimed: false, reason: "transcription-already-processing", decision };
      return;
    }

    const maxAttempts = configuredVoiceMaxAttempts(settings.voiceTranscriptionMaxAttempts);
    const attempts = safeTranscriptionAttempts(current.transcriptionAttempts);
    if (attempts >= maxAttempts) {
      result = { claimed: false, reason: "transcription-attempt-limit-reached", decision };
      transaction.set(messageRef, {
        transcriptionStatus: "failed",
        transcriptionEligibilityStatus: "attempt-limit-reached",
        transcriptionError: current.transcriptionError || "Customer voice transcription retry limit reached.",
        transcriptionFailedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    const storagePath = customerVoiceStoragePath(current);
    if (!storagePath) {
      result = { claimed: false, reason: "customer-voice-media-not-stored", decision };
      transaction.set(messageRef, {
        transcriptionStatus: "waiting_media",
        transcriptionEligibilityStatus: "eligible-waiting-media",
        transcriptionVersion: decision.transcriptionVersion,
        transcriptionModel: cleanText(settings.voiceTranscriptionModel, 120) || TRANSCRIPTION_MODEL,
        transcriptionEligibilityCheckedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    const model = cleanText(settings.voiceTranscriptionModel, 120) || TRANSCRIPTION_MODEL;
    transaction.set(messageRef, {
      mediaStoragePath: storagePath,
      transcriptionStatus: "processing",
      transcriptionEligibilityStatus: "eligible-processing",
      transcriptionVersion: decision.transcriptionVersion,
      transcriptionModel: model,
      transcriptionAttempts: attempts + 1,
      transcriptionClaimId: claimId,
      transcriptionError: FieldValue.delete(),
      transcriptionStartedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    result = { claimed: true, reason: "claimed", claimId, decision, storagePath, model };
  });
  return result;
}

async function finalizeCustomerVoiceClaim(messageRef, claimId, transcriptionVersion, patch) {
  let written = false;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(messageRef);
    if (!snapshot.exists) return;
    const current = snapshot.data() || {};
    if (cleanText(current.transcriptionClaimId, 120) !== cleanText(claimId, 120)) return;
    if (cleanText(current.transcriptionVersion, 80) !== cleanText(transcriptionVersion, 80)) return;
    transaction.set(messageRef, {
      ...patch,
      transcriptionClaimId: FieldValue.delete(),
    }, { merge: true });
    written = true;
  });
  return written;
}

function completedTranscriptionPatch(transcriptionResult, transcriptionVersion, eligibilityStatus = "completed") {
  return {
    rawTranscript: transcriptionResult.transcript,
    transcript: transcriptionResult.transcript,
    transcriptionStatus: "completed",
    transcriptionEligibilityStatus: eligibilityStatus,
    transcriptionVersion,
    transcriptionModel: transcriptionResult.model,
    transcriptionServiceVersion: transcriptionResult.serviceVersion,
    transcriptionError: FieldValue.delete(),
    transcribedAt: FieldValue.serverTimestamp(),
    transcribedAtIso: new Date().toISOString(),
  };
}

async function transcribeCustomerVoiceMessage(messageRef) {
  const { settings, communicationSettings } = await customerVoiceSettings();
  const claim = await claimCustomerVoiceTranscription(messageRef, settings, communicationSettings);
  if (!claim.claimed) return claim;
  let transcriptionResult = null;
  try {
    const snapshot = await messageRef.get();
    const message = snapshot.exists ? snapshot.data() || {} : {};
    transcriptionResult = await transcribeStoredAudio({
      storage,
      storagePath: claim.storagePath,
      contentType: message.mediaMimeType,
      apiKey: openAiApiKey.value(),
      model: claim.model,
      prompt: CUSTOMER_TRANSCRIPTION_PROMPT,
    });
    const finalized = await finalizeCustomerVoiceClaim(
      messageRef,
      claim.claimId,
      claim.decision.transcriptionVersion,
      completedTranscriptionPatch(transcriptionResult, claim.decision.transcriptionVersion),
    );
    if (!finalized) return { claimed: true, completed: false, staleClaim: true, reason: "transcription-claim-superseded" };
    return { claimed: true, completed: true, transcriptionVersion: claim.decision.transcriptionVersion };
  } catch (error) {
    if (transcriptionResult?.transcript) {
      const recovered = await finalizeCustomerVoiceClaim(
        messageRef,
        claim.claimId,
        claim.decision.transcriptionVersion,
        completedTranscriptionPatch(transcriptionResult, claim.decision.transcriptionVersion, "completed-after-write-retry"),
      );
      if (recovered) return { claimed: true, completed: true, recoveredWrite: true };
      return { claimed: true, completed: false, staleClaim: true, reason: "transcription-claim-superseded" };
    }

    const failed = await finalizeCustomerVoiceClaim(messageRef, claim.claimId, claim.decision.transcriptionVersion, {
      transcriptionStatus: "failed",
      transcriptionEligibilityStatus: "eligible-transcription-failed",
      transcriptionError: cleanText(error?.message || error, 500) || "Unknown transcription error",
      transcriptionVersion: claim.decision.transcriptionVersion,
      transcriptionModel: claim.model,
      transcriptionFailedAt: FieldValue.serverTimestamp(),
    });
    if (!failed) return { claimed: true, completed: false, staleClaim: true, reason: "transcription-claim-superseded" };
    logger.error("Could not transcribe customer WhatsApp voice note.", error);
    throw error;
  }
}

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

exports.transcribeNewCustomerVoiceNote = onDocumentCreated(
  {
    document: "whatsappMessages/{messageId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 180,
    retry: true,
    secrets: [openAiApiKey],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const message = { id: snapshot.id, ...snapshot.data() };
    if (!customerVoiceMedia(message) || message.direction !== "inbound") return;
    await transcribeCustomerVoiceMessage(snapshot.ref);
  },
);

exports.transcribeCustomerVoiceWhenReady = onDocumentUpdated(
  {
    document: "whatsappMessages/{messageId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 180,
    retry: true,
    secrets: [openAiApiKey],
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (after.direction !== "inbound" || !customerVoiceUpdateMayChangeEligibility(before, after)) return;
    await transcribeCustomerVoiceMessage(event.data.after.ref);
  },
);

module.exports.CUSTOMER_TRANSCRIPTION_PROMPT = CUSTOMER_TRANSCRIPTION_PROMPT;
module.exports.DEFAULT_CUSTOMER_VOICE_MAX_ATTEMPTS = DEFAULT_CUSTOMER_VOICE_MAX_ATTEMPTS;
module.exports.MAX_CUSTOMER_VOICE_ATTEMPTS = MAX_CUSTOMER_VOICE_ATTEMPTS;
module.exports.TECHNICIAN_TRANSCRIPTION_PROMPT = TECHNICIAN_TRANSCRIPTION_PROMPT;
module.exports.TRANSCRIPTION_MODEL = TRANSCRIPTION_MODEL;
module.exports.claimCustomerVoiceTranscription = claimCustomerVoiceTranscription;
module.exports.completedTranscriptionPatch = completedTranscriptionPatch;
module.exports.configuredVoiceMaxAttempts = configuredVoiceMaxAttempts;
module.exports.customerVoiceSettings = customerVoiceSettings;
module.exports.customerVoiceStoragePath = customerVoiceStoragePath;
module.exports.customerVoiceUpdateMayChangeEligibility = customerVoiceUpdateMayChangeEligibility;
module.exports.finalizeCustomerVoiceClaim = finalizeCustomerVoiceClaim;
module.exports.processingLeaseActive = processingLeaseActive;
module.exports.safeTranscriptionAttempts = safeTranscriptionAttempts;
module.exports.sameEligibilityValue = sameEligibilityValue;
module.exports.transcribeCustomerVoiceMessage = transcribeCustomerVoiceMessage;
