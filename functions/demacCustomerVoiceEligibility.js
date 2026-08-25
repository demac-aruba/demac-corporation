const { cleanText } = require("./bookingSchedulingPrimitives");
const { activeAccountDecision } = require("./demacCommunicationIdentity");

const CUSTOMER_VOICE_POLICY_VERSION = 1;
const VOICE_MEDIA_TYPES = new Set(["audio", "voice"]);

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function customerVoiceMedia(message = {}) {
  return VOICE_MEDIA_TYPES.has(cleanText(message.mediaType || message.type, 40).toLowerCase());
}

function trustedProviderTimestamp(message = {}) {
  return timestampMillis(
    message.providerTimestamp
      || message.whatsappTimestamp
      || message.messageTimestamp
      || message.timestamp,
  );
}

function trustedFirstSeenTimestamp(message = {}) {
  return timestampMillis(
    message.firstReceivedAt
      || message.firstIngestedAt
      || message.firstSeenAt
      || message.receivedAt,
  );
}

function configuredActivationTimestamp(settings = {}) {
  return timestampMillis(
    settings.voiceTranscriptionEnabledAt
      || settings.mayaVoiceTranscriptionEnabledAt,
  );
}

function configuredTranscriptionVersion(settings = {}) {
  return cleanText(
    settings.voiceTranscriptionVersion
      || settings.mayaVoiceTranscriptionVersion,
    80,
  );
}

function existingTranscriptionVersion(message = {}) {
  return cleanText(message.transcriptionVersion, 80);
}

function customerVoiceEligibilityDecision({ message = {}, settings = {} } = {}) {
  if (settings.voiceTranscriptionEnabled !== true) {
    return { eligible: false, reason: "voice-transcription-disabled" };
  }
  if (settings.voiceHistoricalBackfillEnabled === true) {
    return { eligible: false, reason: "historical-backfill-policy-unsafe" };
  }
  if (message.direction !== "inbound") {
    return { eligible: false, reason: "not-canonical-inbound" };
  }
  if (!customerVoiceMedia(message)) {
    return { eligible: false, reason: "not-customer-voice-media" };
  }

  const accountDecision = activeAccountDecision({ message, settings });
  if (!accountDecision.allowed) {
    return { eligible: false, reason: accountDecision.reason };
  }

  const activationAt = configuredActivationTimestamp(settings);
  if (!activationAt) return { eligible: false, reason: "voice-activation-time-not-configured" };

  const providerAt = trustedProviderTimestamp(message);
  const firstSeenAt = trustedFirstSeenTimestamp(message);
  if (!providerAt || !firstSeenAt) {
    return { eligible: false, reason: "timestamp-uncertain" };
  }
  if (providerAt < activationAt) {
    return { eligible: false, reason: "provider-message-before-activation" };
  }
  if (firstSeenAt < activationAt) {
    return { eligible: false, reason: "first-seen-before-activation" };
  }

  const version = configuredTranscriptionVersion(settings);
  if (!version) return { eligible: false, reason: "transcription-version-not-configured" };
  if (
    message.transcriptionStatus === "completed"
    && existingTranscriptionVersion(message) === version
    && cleanText(message.rawTranscript || message.transcript, 8_000)
  ) {
    return { eligible: false, reason: "already-transcribed-current-version", transcriptionVersion: version };
  }

  return {
    eligible: true,
    reason: "eligible-new-inbound-voice",
    transcriptionVersion: version,
    providerAt,
    firstSeenAt,
    activationAt,
  };
}

module.exports = {
  CUSTOMER_VOICE_POLICY_VERSION,
  VOICE_MEDIA_TYPES,
  configuredActivationTimestamp,
  configuredTranscriptionVersion,
  customerVoiceEligibilityDecision,
  customerVoiceMedia,
  timestampMillis,
  trustedFirstSeenTimestamp,
  trustedProviderTimestamp,
};
