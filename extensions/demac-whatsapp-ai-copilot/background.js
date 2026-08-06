const DEFAULT_SETTINGS = {
  backendUrl: "",
  companyName: "DEMAC Professional Cooling Solutions",
  operatorName: "Operaciones",
  maxMessages: 20,
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

function lastInboundMessage(context) {
  return [...(context.messages ?? [])].reverse().find((message) => message.direction === "inbound");
}

function localTestDraft(context, settings) {
  const inbound = lastInboundMessage(context);
  const text = String(inbound?.text ?? "").trim();
  const lower = text.toLocaleLowerCase();
  const name = context.chatTitle ? `, ${context.chatTitle}` : "";

  if (!text) {
    return {
      text: `Buenas tardes${name}. Gracias por comunicarse con ${settings.companyName}. ¿En qué podemos asistirle?`,
      source: "local-test",
      warning: "Borrador local de prueba; todavía no fue generado por OpenAI.",
    };
  }

  if (/cita|appointment|servicio|service|instalaci[oó]n|install/.test(lower)) {
    return {
      text: `Buenas tardes${name}. Con mucho gusto podemos ayudarle. Para coordinar correctamente, ¿podría confirmarnos la dirección del servicio, la cantidad de aires acondicionados y el trabajo que necesita?`,
      source: "local-test",
      warning: "Borrador local de prueba; todavía no consulta la agenda del ERP.",
    };
  }

  if (/precio|price|cu[aá]nto|cost/.test(lower)) {
    return {
      text: `Buenas tardes${name}. Con gusto le ayudamos con el precio. Para darle la información correcta, ¿podría indicarnos el tipo de servicio, la capacidad del aire y la dirección de la propiedad?`,
      source: "local-test",
      warning: "Borrador local de prueba; no debe usarse para confirmar precios sin consultar el ERP.",
    };
  }

  return {
    text: `Buenas tardes${name}. Gracias por escribirnos. Hemos recibido su mensaje y con gusto le ayudaremos. ¿Podría compartir cualquier detalle adicional necesario para atender su solicitud correctamente?`,
    source: "local-test",
    warning: "Borrador local de prueba; todavía no fue generado por OpenAI.",
  };
}

async function callBackend(context, settings) {
  const endpoint = String(settings.backendUrl ?? "").trim();
  if (!endpoint) return localTestDraft(context, settings);

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  if (!text) throw new Error("El backend no devolvió un borrador.");

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
      case "GET_SETTINGS":
        return chrome.storage.local.get(DEFAULT_SETTINGS);
      case "OPEN_OPTIONS":
        await chrome.runtime.openOptionsPage();
        return { ok: true };
      default:
        throw new Error("Acción no reconocida por la extensión.");
    }
  };

  run().then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: error?.message ?? String(error) }),
  );
  return true;
});
