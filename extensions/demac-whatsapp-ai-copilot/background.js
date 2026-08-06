const BUILD_VERSION = chrome.runtime.getManifest().version;
const DEFAULT_SETTINGS = {
  backendUrl: "https://us-central1-demac-corporation.cloudfunctions.net/whatsappCopilotDraft",
  backendToken: "",
  companyName: "DEMAC Professional Cooling Solutions",
  operatorName: "Operaciones",
  maxMessages: 30,
  languageMode: "auto",
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...current });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function getWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  const active = tabs.find((tab) => tab.active) ?? tabs[0];
  if (!active?.id) throw new Error("Abre WhatsApp Web en una pestaña de Chrome.");
  return active;
}

async function sendToWhatsApp(type, payload = {}) {
  const tab = await getWhatsAppTab();
  return chrome.tabs.sendMessage(tab.id, { type, payload });
}

function backendConfiguration(settings) {
  const endpoint = String(settings.backendUrl ?? "").trim();
  const token = String(settings.backendToken ?? "").trim();
  if (!endpoint || !token) {
    throw new Error("OpenAI y la agenda ERP todavía no están configurados. Abre Ajustes y agrega el token privado de Firebase.");
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
  const data = await backendRequest(settings, {
    channel: "whatsapp-web-copilot",
    company: settings.companyName,
    operator: settings.operatorName,
    languageMode: settings.languageMode,
    conversation: context,
    ...extra,
  });
  const text = String(data?.draft ?? data?.message ?? "").trim();
  if (!text) throw new Error("El backend no devolvió una respuesta para revisar.");
  return {
    text,
    source: data?.source ?? "openai",
    warning: data?.warning ?? "",
    metadata: data?.metadata ?? null,
  };
}

async function testBackend(settings) {
  const data = await backendRequest(settings, { mode: "health" });
  if (!data?.ok || !data?.openAiConfigured) {
    throw new Error("Firebase respondió, pero la clave de OpenAI no está disponible.");
  }
  if (!data?.erpSchedulingConfigured) {
    throw new Error("OpenAI está conectado, pero la consulta de agenda ERP no está activada.");
  }
  return {
    connected: true,
    model: data.model || "OpenAI",
    source: data.source || "openai+erp",
    erpSchedulingConfigured: true,
    papiamentoVocabulary: data.papiamentoVocabulary ?? null,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
