const BUILD_VERSION = "0.2.1";
const DEFAULT_SETTINGS = {
  backendUrl: "https://us-central1-demac-corporation.cloudfunctions.net/whatsappCopilotDraft",
  backendToken: "",
  companyName: "DEMAC Professional Cooling Solutions",
  operatorName: "Operaciones",
  maxMessages: 24,
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

async function callBackend(context, settings) {
  const endpoint = String(settings.backendUrl ?? "").trim();
  const token = String(settings.backendToken ?? "").trim();
  if (!endpoint || !token) throw new Error("El backend de OpenAI todavía no está configurado.");

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: "whatsapp-web-copilot",
        company: settings.companyName,
        operator: settings.operatorName,
        languageMode: settings.languageMode,
        conversation: context,
      }),
    });
  } catch (error) {
    throw new Error(`No se pudo conectar con el backend: ${error.message}`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error ?? `El backend respondió HTTP ${response.status}.`);
  const text = String(data?.draft ?? data?.message ?? "").trim();
  if (!text) throw new Error("El backend no devolvió una respuesta.");
  return {
    text,
    source: data?.source ?? "backend",
    warning: data?.warning ?? "",
    metadata: data?.metadata ?? null,
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
