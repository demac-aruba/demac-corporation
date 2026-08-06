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

function latestCustomerText(context) {
  const grouped = String(context?.customerTurn?.text ?? "").trim();
  if (grouped) return grouped;
  const inbound = [...(context?.messages ?? [])]
    .reverse()
    .find((message) => message.direction === "inbound");
  return String(inbound?.text ?? "").trim();
}

function localTestDraft(context, settings) {
  const text = latestCustomerText(context);
  const lower = text.toLocaleLowerCase();

  if (!text) {
    return {
      text: `Buenas tardes. Gracias por comunicarse con ${settings.companyName}. ¿En qué podemos asistirle?`,
      source: "local-test",
      warning: "No se identificó todavía un mensaje recibido. Revisa el conteo de recibidos y vuelve a leer el chat.",
      metadata: { intent: "unknown", customerTurn: "" },
    };
  }

  if (/servicio|service|mantenimiento|maintenance|limpia|clean|airco|aire/.test(lower)) {
    return {
      text: "Buenas tardes. Con mucho gusto podemos coordinar el servicio de sus aires acondicionados. ¿Cuántos aires necesitan servicio y cuál es la dirección de la propiedad?",
      source: "local-test",
      warning: "Respuesta local mejorada. Configura el token del backend para generar respuestas con OpenAI.",
      metadata: { intent: "service_request", customerTurn: text },
    };
  }

  if (/instalaci[oó]n|install|airco nobo|aire nuevo/.test(lower)) {
    return {
      text: "Buenas tardes. Con mucho gusto podemos ayudarle con la instalación. ¿Cuántos aires desea instalar, en qué dirección y ya conoce las capacidades aproximadas?",
      source: "local-test",
      warning: "Respuesta local mejorada. Todavía no consulta precios ni disponibilidad del ERP.",
      metadata: { intent: "installation_request", customerTurn: text },
    };
  }

  if (/cita|appointment|disponib|fecha|hora/.test(lower)) {
    return {
      text: "Buenas tardes. Con gusto podemos ayudarle a coordinar una cita. ¿Qué trabajo necesita, cuántos aires son y cuál es la dirección de la propiedad?",
      source: "local-test",
      warning: "Respuesta local mejorada. Todavía no consulta la agenda del ERP.",
      metadata: { intent: "appointment_question", customerTurn: text },
    };
  }

  if (/precio|price|cu[aá]nto|cost/.test(lower)) {
    return {
      text: "Buenas tardes. Con gusto le ayudamos con la información de precio. ¿Podría indicarnos el servicio requerido, la cantidad de aires y la dirección?",
      source: "local-test",
      warning: "No confirmes precios hasta conectarlo con la información autorizada del ERP.",
      metadata: { intent: "price_question", customerTurn: text },
    };
  }

  return {
    text: "Buenas tardes. Gracias por escribirnos. Hemos leído su solicitud y con gusto le ayudaremos. ¿Podría compartir el detalle que falte para poder atenderla correctamente?",
    source: "local-test",
    warning: "Respuesta local mejorada. Configura el backend para comprensión completa con OpenAI.",
    metadata: { intent: "general_question", customerTurn: text },
  };
}

async function callBackend(context, settings) {
  const endpoint = String(settings.backendUrl ?? "").trim();
  const token = String(settings.backendToken ?? "").trim();
  if (!endpoint || !token) return localTestDraft(context, settings);

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
      case "SEND_DRAFT":
        return sendToWhatsApp("SEND_DRAFT", { text: message.payload?.text ?? "" });
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
