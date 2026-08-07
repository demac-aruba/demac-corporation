import {
  learnConversationMemory,
  prepareConversationContext,
} from "./conversation-memory.mjs";
import {
  autoTestStatus,
  buildAutoTestSession,
  contextMatchesAutoTestSession,
  latestInboundFingerprint,
  shouldAutoReply,
} from "./auto-test-mode.mjs";

const BUILD_VERSION = chrome.runtime.getManifest().version;
const AUTO_TEST_SESSION_KEY = "demacWhatsAppAutoTestModeV1";
const AUTO_TEST_SETTLE_MS = 1600;
const DEFAULT_SETTINGS = {
  backendUrl: "https://us-central1-demac-corporation.cloudfunctions.net/whatsappCopilotDraft",
  backendToken: "",
  companyName: "DEMAC Professional Cooling Solutions",
  operatorName: "Operaciones",
  maxMessages: 30,
  languageMode: "auto",
};
const AUTO_STATE = {
  timer: null,
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...current });
  await chrome.storage.session.remove(AUTO_TEST_SESSION_KEY);
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function getWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  const active = tabs.find((tab) => tab.active) ?? tabs[0];
  if (!active?.id) throw new Error("Abre WhatsApp Web en una pestaña de Chrome.");
  return active;
}

async function sendToWhatsApp(type, payload = {}, tabId = null) {
  const id = tabId ?? (await getWhatsAppTab()).id;
  if (!id) throw new Error("No se encontró la pestaña de WhatsApp Web.");
  return chrome.tabs.sendMessage(id, { type, payload });
}

async function readContextFromTab(tabId, maxMessages = 30) {
  const response = await sendToWhatsApp("READ_ACTIVE_CHAT", { maxMessages }, tabId);
  if (response?.error) throw new Error(response.error);
  return response;
}

function backendConfiguration(settings) {
  const endpoint = String(settings.backendUrl ?? "").trim();
  const token = String(settings.backendToken ?? "").trim();
  if (!endpoint || !token) {
    throw new Error("OpenAI y el ERP todavía no están configurados. Abre Ajustes y agrega el token privado de Firebase.");
  }
  return { endpoint, token };
}

async function backendRequest(settings, body) {
  const { endpoint, token } = backendConfiguration(settings);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`No se pudo conectar con Firebase: ${error.message}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error ?? `Firebase respondió HTTP ${response.status}.`);
  return data;
}

async function callBackend(context, settings, extra = {}) {
  let prepared = { context, key: "", facts: {} };
  try {
    prepared = await prepareConversationContext(context, chrome.storage.local);
  } catch (error) {
    console.warn("DEMAC Copilot could not prepare conversation memory.", error);
  }

  const data = await backendRequest(settings, {
    channel: "whatsapp-web-copilot",
    company: settings.companyName,
    operator: settings.operatorName,
    languageMode: settings.languageMode,
    conversation: prepared.context,
    ...extra,
  });

  try {
    await learnConversationMemory(
      prepared.key,
      prepared.facts,
      data?.metadata,
      chrome.storage.local,
    );
  } catch (error) {
    console.warn("DEMAC Copilot could not update conversation memory.", error);
  }

  const text = String(data?.draft ?? data?.message ?? "").trim();
  if (!text) throw new Error("El backend no devolvió una respuesta para revisar.");
  return {
    text,
    source: data?.source ?? "openai+erp",
    warning: data?.warning ?? "",
    metadata: data?.metadata ?? null,
  };
}

async function testBackend(settings) {
  const data = await backendRequest(settings, { mode: "health" });
  if (!data?.ok || !data?.openAiConfigured) {
    throw new Error("Firebase respondió, pero la clave de OpenAI no está disponible.");
  }
  if (!data?.erpSchedulingConfigured || !data?.erpKnowledgeConfigured) {
    throw new Error("OpenAI está conectado, pero la agenda o la base de conocimiento del ERP no están activadas.");
  }
  return {
    connected: true,
    model: data.model || "OpenAI",
    source: data.source || "openai+erp",
    erpSchedulingConfigured: true,
    erpKnowledgeConfigured: true,
    papiamentoVocabulary: data.papiamentoVocabulary ?? null,
  };
}

async function getAutoTestSession() {
  const stored = await chrome.storage.session.get(AUTO_TEST_SESSION_KEY);
  return stored?.[AUTO_TEST_SESSION_KEY] ?? null;
}

async function saveAutoTestSession(session) {
  await chrome.storage.session.set({ [AUTO_TEST_SESSION_KEY]: session });
  return session;
}

async function publishAutoTestEvent(event) {
  try {
    await chrome.runtime.sendMessage({ type: "AUTO_TEST_EVENT", payload: event });
  } catch (_error) {
    // The side panel may be closed. Automatic mode continues in the service worker.
  }
}

async function updateAutoTestSession(patch, event = null) {
  const current = await getAutoTestSession();
  const next = {
    ...(current || {}),
    ...patch,
    ...(event ? { lastEvent: event, lastEventAt: new Date().toISOString() } : {}),
  };
  await saveAutoTestSession(next);
  await publishAutoTestEvent({ status: autoTestStatus(next), message: event || "" });
  return next;
}

async function disableAutoTestMode(reason = "Modo automático de prueba desactivado.") {
  clearTimeout(AUTO_STATE.timer);
  AUTO_STATE.timer = null;
  const current = await getAutoTestSession();
  const next = {
    ...(current || {}),
    enabled: false,
    processingFingerprint: "",
    lastEvent: reason,
    lastEventAt: new Date().toISOString(),
  };
  await saveAutoTestSession(next);
  await publishAutoTestEvent({ status: autoTestStatus(next), message: reason });
  return autoTestStatus(next);
}

async function getAutoTestStatus() {
  const session = await getAutoTestSession();
  const status = autoTestStatus(session);
  if (session?.enabled && !status.enabled) {
    return disableAutoTestMode("El modo automático de prueba expiró y fue desactivado.");
  }
  return status;
}

function requiresHumanReview(result) {
  return result?.metadata?.requiresHuman === true
    || result?.metadata?.nextAction === "transfer_human";
}

async function finishAutoAttempt(session, fingerprint, event, extra = {}) {
  const next = {
    ...session,
    lastHandledFingerprint: fingerprint,
    processingFingerprint: "",
    lastEvent: event,
    lastEventAt: new Date().toISOString(),
  };
  await saveAutoTestSession(next);
  await publishAutoTestEvent({
    status: autoTestStatus(next),
    message: event,
    ...extra,
  });
}

async function runAutoReply(tabId) {
  let session = await getAutoTestSession();
  if (!autoTestStatus(session).enabled) return;

  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  let context;
  let fingerprint = "";
  try {
    context = await readContextFromTab(tabId, settings.maxMessages);
    const decision = shouldAutoReply(context, session);
    if (!decision.allowed) return;
    fingerprint = decision.fingerprint;
    session = await updateAutoTestSession(
      { processingFingerprint: fingerprint },
      `Analizando automáticamente el último mensaje de ${session.chatTitle}…`,
    );

    let result = await callBackend(context, settings);
    if (requiresHumanReview(result)) {
      await finishAutoAttempt(
        session,
        fingerprint,
        "La IA solicitó revisión humana. No se envió ningún mensaje automáticamente.",
        { draft: result.text, result },
      );
      return;
    }

    if (result?.metadata?.nextAction === "reserve_erp_appointment") {
      await publishAutoTestEvent({
        status: autoTestStatus(session),
        message: "El cliente seleccionó una cita. Revalidando el cupo y creando la orden en el ERP…",
        draft: result.text,
        result,
      });
      result = await callBackend(context, settings, { commitAppointment: true, autoTestMode: true });
      if (requiresHumanReview(result) || result?.metadata?.nextAction === "reserve_erp_appointment") {
        await finishAutoAttempt(
          session,
          fingerprint,
          "La cita no pudo confirmarse automáticamente. Se detuvo el envío para revisión.",
          { draft: result.text, result },
        );
        return;
      }
    }

    const freshContext = await readContextFromTab(tabId, settings.maxMessages);
    const freshSession = await getAutoTestSession();
    const freshFingerprint = latestInboundFingerprint(freshContext);
    if (!contextMatchesAutoTestSession(freshContext, freshSession)) {
      await updateAutoTestSession(
        { processingFingerprint: "" },
        "La conversación abierta cambió mientras la IA respondía. No se envió el mensaje.",
      );
      return;
    }
    if (freshFingerprint !== fingerprint) {
      await updateAutoTestSession(
        { processingFingerprint: "" },
        "Llegó un mensaje nuevo mientras la IA respondía. Se descartó el borrador anterior para contestar el turno más reciente.",
      );
      scheduleAutoReply(freshContext, tabId);
      return;
    }

    await publishAutoTestEvent({
      status: autoTestStatus(freshSession),
      message: "Respuesta generada. Enviando automáticamente por WhatsApp…",
      draft: result.text,
      result,
    });
    const sent = await sendToWhatsApp("SEND_DRAFT", { text: result.text }, tabId);
    if (sent?.error) throw new Error(sent.error);
    if (!sent?.sent) throw new Error("WhatsApp no confirmó el envío automático.");

    await finishAutoAttempt(
      freshSession,
      fingerprint,
      "Respuesta automática enviada correctamente.",
      { draft: result.text, result, sent: true },
    );
  } catch (error) {
    console.error("DEMAC Copilot auto-test reply failed.", error);
    const latest = await getAutoTestSession();
    await finishAutoAttempt(
      latest || session || {},
      fingerprint || latest?.processingFingerprint || "",
      `Error en respuesta automática: ${error?.message ?? String(error)}`,
      { error: error?.message ?? String(error) },
    );
  }
}

async function scheduleAutoReply(context, tabId) {
  const session = await getAutoTestSession();
  const decision = shouldAutoReply(context, session);
  if (!decision.allowed) return { scheduled: false, reason: decision.reason };
  clearTimeout(AUTO_STATE.timer);
  AUTO_STATE.timer = setTimeout(() => {
    AUTO_STATE.timer = null;
    runAutoReply(tabId).catch((error) => console.error("Auto-test timer failed.", error));
  }, AUTO_TEST_SETTLE_MS);
  return { scheduled: true, reason: decision.reason };
}

async function enableAutoTestMode(context) {
  const session = buildAutoTestSession(context);
  await saveAutoTestSession(session);
  await publishAutoTestEvent({
    status: autoTestStatus(session),
    message: `Modo automático activado únicamente para ${session.chatTitle}.`,
  });
  const tab = await getWhatsAppTab();
  await scheduleAutoReply(context, tab.id);
  return autoTestStatus(session);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case "PING":
      case "PING_BACKGROUND":
        return { buildVersion: BUILD_VERSION };
      case "GET_ACTIVE_CONTEXT": {
        const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
        return sendToWhatsApp("READ_ACTIVE_CHAT", { maxMessages: settings.maxMessages });
      }
      case "GENERATE_DRAFT": {
        const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
        return callBackend(message.payload?.context ?? {}, settings);
      }
      case "CONFIRM_APPOINTMENT": {
        const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
        return callBackend(message.payload?.context ?? {}, settings, { commitAppointment: true });
      }
      case "TEST_BACKEND": {
        const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
        return testBackend(settings);
      }
      case "INSERT_DRAFT":
        return sendToWhatsApp("INSERT_DRAFT", { text: message.payload?.text ?? "" });
      case "SEND_DRAFT":
      case "SEND_NOW":
      case "SEND_MESSAGE":
        return sendToWhatsApp("SEND_DRAFT", { text: message.payload?.text ?? "" });
      case "ENABLE_AUTO_TEST_MODE":
        return enableAutoTestMode(message.payload?.context ?? {});
      case "DISABLE_AUTO_TEST_MODE":
        return disableAutoTestMode();
      case "GET_AUTO_TEST_STATUS":
        return getAutoTestStatus();
      case "ACTIVE_CONTEXT_CHANGED": {
        const tabId = sender?.tab?.id;
        if (!tabId || !message.payload) return { scheduled: false, reason: "missing-tab" };
        return scheduleAutoReply(message.payload, tabId);
      }
      case "GET_SETTINGS":
        return chrome.storage.local.get(DEFAULT_SETTINGS);
      case "OPEN_OPTIONS":
        await chrome.runtime.openOptionsPage();
        return { opened: true };
      default:
        throw new Error(`Acción no reconocida por el motor ${BUILD_VERSION}: ${String(message?.type || "vacía")}`);
    }
  };

  run().then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: error?.message ?? String(error), buildVersion: BUILD_VERSION }),
  );
  return true;
});