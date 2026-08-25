const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_TRANSCRIPTION_MODEL,
  audioFileName,
  firebaseStoragePathFromMediaUrl,
  requestTranscription,
} = require("./demacTranscriptionService");

test("shared transcription service preserves existing audio extension", () => {
  assert.equal(audioFileName("voice/customer-note.ogg", "audio/ogg"), "customer-note.ogg");
  assert.equal(audioFileName("voice/customer-note", "audio/webm"), "customer-note.webm");
  assert.equal(audioFileName("voice/customer-note", "audio/mpeg"), "customer-note.mp3");
});

test("shared transcription service accepts only canonical Firebase Storage media URLs", () => {
  const url = "https://firebasestorage.googleapis.com/v0/b/demac.appspot.com/o/communication-media%2Fwacli%2Fchat%2Fmsg.ogg?alt=media&token=abc";
  assert.equal(
    firebaseStoragePathFromMediaUrl(url, "demac.appspot.com"),
    "communication-media/wacli/chat/msg.ogg",
  );
  assert.equal(firebaseStoragePathFromMediaUrl(url, "other.appspot.com"), "");
  assert.equal(firebaseStoragePathFromMediaUrl("https://example.com/audio.ogg", "demac.appspot.com"), "");
});

test("shared transcription service requires audio bytes and server API key", async () => {
  await assert.rejects(
    requestTranscription({ audioBuffer: Buffer.alloc(0), apiKey: "secret" }),
    /non-empty audio buffer/i,
  );
  await assert.rejects(
    requestTranscription({ audioBuffer: Buffer.from("audio"), apiKey: "" }),
    /API key is required/i,
  );
});

test("shared transcription service returns transcript and configured model", async () => {
  let request = null;
  const result = await requestTranscription({
    audioBuffer: Buffer.from("fake-audio"),
    fileName: "note.ogg",
    contentType: "audio/ogg",
    apiKey: "server-secret",
    prompt: "Preserve the spoken language.",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: "Bon dia, mi kier cambia mi cita." }),
      };
    },
  });
  assert.equal(request.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer server-secret");
  assert.equal(result.transcript, "Bon dia, mi kier cambia mi cita.");
  assert.equal(result.model, DEFAULT_TRANSCRIPTION_MODEL);
  assert.equal(result.serviceVersion, 1);
});

test("shared transcription service does not invent content on provider failure", async () => {
  await assert.rejects(
    requestTranscription({
      audioBuffer: Buffer.from("fake-audio"),
      fileName: "note.ogg",
      contentType: "audio/ogg",
      apiKey: "server-secret",
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: "rate limited", code: "rate_limit" } }),
      }),
    }),
    (error) => error.message === "rate limited" && error.code === "rate_limit",
  );
});
