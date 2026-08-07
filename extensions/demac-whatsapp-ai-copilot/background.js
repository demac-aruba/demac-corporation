import {
  learnConversationMemory,
  prepareConversationContext,
} from "./conversation-memory.mjs";

const BUILD_VERSION = chrome.runtime.getManifest().version;
const LEGACY_AUTO_TEST_SESSION_KEY = "demacWhatsAppAutoTestModeV1";
const DEFAULT_SETTINGS = {
  backendUrl: "https://us-central1-demac-corporation.cloudfunctions.net/whatsappCopilotDraft",
  backendToken: "",
  companyName: "DEMAC Professional Cooling Solutions",
  operatorName: "Operaciones",
  maxMessages: 30,
  languageMode: "auto",
};

async function clearLegacyAutoSession() {
  try {
    await chrome.storage.session.remove(LEGACY_AUTO_TEST_SESSION_KEY);
  } catch (_error) {
    // The V18 test runner lives only in the side panel; a missing session area is harmless.
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...current });
  await clearLegacyAutoSession();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup?.addListener(() => {
  void clearLegacyAutoSession();
});

// Clear any stale v0.4.8 background auto-session whenever this V18 worker loads.
void clearLegacyAutoSession();

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
    runtime: data?.runtime ?? null,
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
    functionName: data.functionName || "",
    conversationPolicyVersion: data.conversationPolicyVersion ?? null,
    currentTurnPolicy: data.currentTurnPolicy || "",
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case "PING":
      case "PING_BACKGROUND":
        return { buildVersion: BUILD_VERSION, autoReplyEngine: "side-panel-only" };
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

      // V18 deliberately has only ONE automatic reply engine: auto-test-panel.js.
      // These legacy events are acknowledged but never schedule or send anything.
      case "ACTIVE_CONTEXT_CHANGED":
        return { scheduled: false, reason: "v18-side-panel-controls-auto-replies" };
      case "ENABLE_AUTO_TEST_MODE":
      case "DISABLE_AUTO_TEST_MODE":
      case "GET_AUTO_TEST_STATUS":
        await clearLegacyAutoSession();
        return { enabled: false, legacyEngineDisabled: true };

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