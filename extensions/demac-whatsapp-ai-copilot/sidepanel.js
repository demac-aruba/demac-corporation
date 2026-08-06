const BUILD_VERSION = "0.2.1";
const DEFAULT_SETTINGS = {
  backendUrl: "https://us-central1-demac-corporation.cloudfunctions.net/whatsappCopilotDraft",
  backendToken: "",
  companyName: "DEMAC Professional Cooling Solutions",
  operatorName: "Operaciones",
  maxMessages: 24,
  languageMode: "auto",
};

const state = {
  context: null,
  draft: "",
};

const elements = {
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  settingsButton: document.querySelector("#settingsButton"),
  chatTitle: document.querySelector("#chatTitle"),
  contextSummary: document.querySelector("#contextSummary"),
  customerTurnCard: document.querySelector("#customerTurnCard"),
  customerTurnText: document.querySelector("#customerTurnText"),
  messageList: document.querySelector("#messageList"),
  refreshButton: document.querySelector("#refreshButton"),
  generateButton: document.querySelector("#generateButton"),
  insertButton: document.querySelector("#insertButton"),
  sendButton: document.querySelector("#sendButton"),
  draftText: document.querySelector("#draftText"),
  draftSource: document.querySelector("#draftSource"),
  draftWarning: document.querySelector("#draftWarning"),
  buildInfo: document.querySelector("#buildInfo"),
};

function setStatus(text, kind = "idle") {
  elements.statusText.textContent = text;
  elements.statusDot.dataset.kind = kind;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  const active = tabs.find((tab) => tab.active) ?? tabs[0];
  if (!active?.id) throw new Error("Abre WhatsApp Web en una pestaña de Chrome.");
  return active;
}

async function requestWhatsApp(type, payload = {}) {
  const tab = await getWhatsAppTab();
  const response = await chrome.tabs.sendMessage(tab.id, { type, payload });
  if (response?.error) throw new Error(response.error);
  return response;
}

async function requestBackground(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.ok) throw new Error(response?.error ?? "La extensión no pudo completar la acción.");
  if (response.result?.error) throw new Error(response.result.error);
  return response.result;
}

function latestCustomerText(context) {
  const grouped = String(context?.customerTurn?.text ?? "").trim();
  if (grouped) return grouped;
  const inbound = [...(context?.messages ?? [])]
    .reverse()
    .find((message) => message.direction === "inbound"
      || (message.positionRatio !== null && message.positionRatio < 0.5));
  return String(inbound?.text ?? "").trim();
}

function localDraft(context, settings) {
  const text = latestCustomerText(context);
  const lower = text.toLocaleLowerCase();

  if (!text) {
    return {
      text: `Buenas tardes. Gracias por comunicarse con ${settings.companyName}. ¿En qué podemos asistirle?`,
      source: "local-test",
      warning: "No se identificó una solicitud del cliente. Confirma que aparezcan mensajes recibidos o una solicitud agrupada.",
    };
  }

  if (/servicio|service|mantenimiento|maintenance|limpia|clean|airco|aire|aires/.test(lower)) {
    return {
      text: "Buenas tardes. Con mucho gusto podemos coordinar el servicio de sus aires acondicionados. ¿Cuántos aires necesitan servicio y cuál es la dirección de la propiedad?",
      source: "local-test",
      warning: "Respuesta local basada en la solicitud agrupada. OpenAI se activará al configurar el backend.",
    };
  }

  if (/instalaci[oó]n|install|airco nobo|aire nuevo/.test(lower)) {
    return {
      text: "Buenas tardes. Con mucho gusto podemos ayudarle con la instalación. ¿Cuántos aires desea instalar, en qué dirección y ya conoce las capacidades aproximadas?",
      source: "local-test",
      warning: "Respuesta local. Todavía no consulta precios ni disponibilidad del ERP.",
    };
  }

  if (/cita|appointment|disponib|fecha|hora/.test(lower)) {
    return {
      text: "Buenas tardes. Con gusto podemos ayudarle a coordinar una cita. ¿Qué trabajo necesita, cuántos aires son y cuál es la dirección de la propiedad?",
      source: "local-test",
      warning: "Respuesta local. Todavía no consulta la agenda del ERP.",
    };
  }

  if (/precio|price|cu[aá]nto|cost/.test(lower)) {
    return {
      text: "Buenas tardes. Con gusto le ayudamos con la información de precio. ¿Podría indicarnos el servicio requerido, la cantidad de aires y la dirección?",
      source: "local-test",
      warning: "No confirmes precios hasta conectarlo con la información autorizada del ERP.",
    };
  }

  return {
    text: "Buenas tardes. Gracias por escribirnos. Hemos leído su solicitud y con gusto le ayudaremos. ¿Podría compartir el detalle que falte para poder atenderla correctamente?",
    source: "local-test",
    warning: "Respuesta local. La comprensión completa se habilitará con OpenAI.",
  };
}

function renderContext(context) {
  state.context = context;
  elements.chatTitle.textContent = context.chatTitle || "Chat sin nombre visible";
  const inbound = context.messages.filter((message) => message.direction === "inbound").length;
  const outbound = context.messages.filter((message) => message.direction === "outbound").length;
  const unknown = context.messages.filter((message) => message.direction === "unknown").length;
  elements.contextSummary.textContent = `${context.messages.length} visibles · ${inbound} recibidos · ${outbound} enviados${unknown ? ` · ${unknown} sin clasificar` : ""}`;

  const customerTurn = String(context.customerTurn?.text ?? "").trim();
  elements.customerTurnCard.hidden = !customerTurn;
  elements.customerTurnText.textContent = customerTurn;

  elements.messageList.innerHTML = context.messages.slice(-10).map((message) => {
    const direction = message.direction === "inbound"
      ? "Cliente"
      : message.direction === "outbound"
        ? "DEMAC"
        : "Sin clasificar";
    return `<article class="message ${escapeHtml(message.direction)}"><span>${direction}</span><p>${escapeHtml(message.text)}</p></article>`;
  }).join("");

  const contentVersion = context.buildVersion || "desconocida";
  elements.buildInfo.textContent = `Panel ${BUILD_VERSION} · lector ${contentVersion}`;
  if (contentVersion !== BUILD_VERSION) {
    setStatus("Lector desactualizado: recarga WhatsApp Web", "error");
  } else if (customerTurn) {
    setStatus("Solicitud del cliente identificada", "ready");
  } else if (inbound > 0) {
    setStatus("Conversación lista", "ready");
  } else {
    setStatus("Lectura parcial: no se detectó la solicitud", "error");
  }
}

function clearContext(errorMessage) {
  state.context = null;
  elements.chatTitle.textContent = "Ninguna seleccionada";
  elements.contextSummary.textContent = errorMessage;
  elements.customerTurnCard.hidden = true;
  elements.messageList.innerHTML = "";
  setStatus("No se pudo leer el chat", "error");
}

function updateDraftButtons() {
  const hasText = Boolean(elements.draftText.value.trim());
  elements.insertButton.disabled = !hasText;
  elements.sendButton.disabled = !hasText;
}

async function refreshContext() {
  setStatus("Leyendo conversación…", "working");
  elements.refreshButton.disabled = true;
  try {
    const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
    const context = await requestWhatsApp("READ_ACTIVE_CHAT", { maxMessages: settings.maxMessages });
    renderContext(context);
  } catch (error) {
    clearContext(error.message);
  } finally {
    elements.refreshButton.disabled = false;
  }
}

async function generateDraft() {
  if (!state.context) await refreshContext();
  if (!state.context) return;

  elements.generateButton.disabled = true;
  setStatus("Comprendiendo la solicitud…", "working");
  try {
    const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
    const hasBackend = Boolean(String(settings.backendUrl || "").trim() && String(settings.backendToken || "").trim());
    const result = hasBackend
      ? await requestBackground("GENERATE_DRAFT", { context: state.context })
      : localDraft(state.context, settings);
    state.draft = result.text;
    elements.draftText.value = result.text;
    elements.draftSource.textContent = result.source === "local-test" ? "Respuesta local" : "OpenAI";
    elements.draftWarning.textContent = result.warning || "";
    updateDraftButtons();
    setStatus("Respuesta lista para revisar", "ready");
  } catch (error) {
    elements.draftWarning.textContent = error.message;
    setStatus("Error al generar la respuesta", "error");
  } finally {
    elements.generateButton.disabled = false;
  }
}

async function insertDraft() {
  const text = elements.draftText.value.trim();
  if (!text) return;

  elements.insertButton.disabled = true;
  setStatus("Insertando respuesta…", "working");
  try {
    await requestWhatsApp("INSERT_DRAFT", { text });
    setStatus("Respuesta insertada; revisa y envía", "ready");
  } catch (error) {
    elements.draftWarning.textContent = error.message;
    setStatus("No se pudo insertar", "error");
  } finally {
    updateDraftButtons();
  }
}

async function sendDraft() {
  const text = elements.draftText.value.trim();
  if (!text) return;

  const confirmed = window.confirm(`¿Enviar este mensaje ahora a ${state.context?.chatTitle || "la conversación abierta"}?`);
  if (!confirmed) return;

  elements.sendButton.disabled = true;
  setStatus("Enviando respuesta…", "working");
  try {
    const result = await requestWhatsApp("SEND_DRAFT", { text });
    if (!result?.sent) throw new Error("WhatsApp no confirmó el envío.");
    setStatus("Mensaje enviado correctamente", "ready");
    elements.draftWarning.textContent = "";
    setTimeout(refreshContext, 900);
  } catch (error) {
    elements.draftWarning.textContent = error.message;
    setStatus("No se pudo enviar", "error");
  } finally {
    updateDraftButtons();
  }
}

elements.refreshButton.addEventListener("click", refreshContext);
elements.generateButton.addEventListener("click", generateDraft);
elements.insertButton.addEventListener("click", insertDraft);
elements.sendButton.addEventListener("click", sendDraft);
elements.settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
elements.draftText.addEventListener("input", () => {
  state.draft = elements.draftText.value;
  updateDraftButtons();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "ACTIVE_CONTEXT_CHANGED" && message.payload) renderContext(message.payload);
});

elements.buildInfo.textContent = `Panel ${BUILD_VERSION}`;
refreshContext();
