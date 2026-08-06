const BUILD_VERSION = chrome.runtime.getManifest().version;
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
  initialized: false,
};

let elements = {};

function byId(id) {
  return document.getElementById(id);
}

function setText(element, value) {
  if (element) element.textContent = String(value ?? "");
}

function setHtml(element, value) {
  if (element) element.innerHTML = String(value ?? "");
}

function setHidden(element, hidden) {
  if (element) element.hidden = Boolean(hidden);
}

function setDisabled(element, disabled) {
  if (element) element.disabled = Boolean(disabled);
}

function setStatus(text, kind = "idle") {
  setText(elements.statusText, text);
  if (elements.statusDot) elements.statusDot.dataset.kind = kind;
}

function setWarning(text) {
  setText(elements.draftWarning, text);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function collectElements() {
  elements = {
    statusDot: byId("statusDot"),
    statusText: byId("statusText"),
    settingsButton: byId("settingsButton"),
    chatTitle: byId("chatTitle"),
    contextSummary: byId("contextSummary"),
    customerTurnCard: byId("customerTurnCard"),
    customerTurnText: byId("customerTurnText"),
    messageList: byId("messageList"),
    refreshButton: byId("refreshButton"),
    generateButton: byId("generateButton"),
    insertButton: byId("insertButton"),
    sendButton: byId("sendButton"),
    draftText: byId("draftText"),
    draftSource: byId("draftSource"),
    draftWarning: byId("draftWarning"),
    buildInfo: byId("buildInfo"),
    versionText: byId("versionText"),
  };

  const required = [
    "statusText",
    "chatTitle",
    "contextSummary",
    "messageList",
    "refreshButton",
    "generateButton",
    "insertButton",
    "sendButton",
    "draftText",
    "draftSource",
    "draftWarning",
  ];
  return required.filter((key) => !elements[key]);
}

function renderFatalPanelError(missingIds) {
  document.body.innerHTML = `
    <main style="font-family:system-ui;padding:18px;color:#142033">
      <h2 style="margin-top:0">DEMAC WhatsApp AI Copilot</h2>
      <p>No se pudo iniciar el panel porque faltan componentes de la interfaz.</p>
      <p style="color:#a33"><strong>Archivos mezclados o actualización incompleta:</strong> ${escapeHtml(missingIds.join(", "))}</p>
      <p>Cierra este panel, recarga la extensión en <code>chrome://extensions</code> y vuelve a abrir WhatsApp Web.</p>
      <p>Versión del código: ${escapeHtml(BUILD_VERSION)}</p>
    </main>`;
}

function isConnectionError(error) {
  const message = String(error?.message ?? error ?? "").toLocaleLowerCase();
  return message.includes("receiving end does not exist")
    || message.includes("could not establish connection")
    || message.includes("message port closed")
    || message.includes("no tab with id");
}

async function getWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  const active = tabs.find((tab) => tab.active) ?? tabs[0];
  if (!active?.id) throw new Error("Abre WhatsApp Web en una pestaña de Chrome.");
  return active;
}

async function injectCurrentReader(tabId) {
  if (!chrome.scripting?.executeScript) {
    throw new Error("El lector no está cargado. Recarga WhatsApp Web con Ctrl + Shift + R.");
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
}

async function requestWhatsApp(type, payload = {}) {
  const tab = await getWhatsAppTab();
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type, payload });
    if (response?.error) throw new Error(response.error);
    return response;
  } catch (error) {
    if (!isConnectionError(error)) throw error;
    await injectCurrentReader(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type, payload });
    if (response?.error) throw new Error(response.error);
    return response;
  }
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
      || (Number.isFinite(message.positionRatio) && message.positionRatio < 0.52));
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
  const messages = Array.isArray(context?.messages) ? context.messages : [];
  state.context = { ...context, messages };

  setText(elements.chatTitle, context?.chatTitle || "Chat sin nombre visible");
  const inbound = messages.filter((message) => message.direction === "inbound").length;
  const outbound = messages.filter((message) => message.direction === "outbound").length;
  const unknown = messages.filter((message) => message.direction === "unknown").length;
  setText(
    elements.contextSummary,
    `${messages.length} visibles · ${inbound} recibidos · ${outbound} enviados${unknown ? ` · ${unknown} sin clasificar` : ""}`,
  );

  const customerTurn = String(context?.customerTurn?.text ?? "").trim();
  setHidden(elements.customerTurnCard, !customerTurn);
  setText(elements.customerTurnText, customerTurn);

  setHtml(elements.messageList, messages.slice(-10).map((message) => {
    const direction = message.direction === "inbound"
      ? "Cliente"
      : message.direction === "outbound"
        ? "DEMAC"
        : "Sin clasificar";
    return `<article class="message ${escapeHtml(message.direction)}"><span>${direction}</span><p>${escapeHtml(message.text)}</p></article>`;
  }).join(""));

  const contentVersion = String(context?.buildVersion || "desconocida");
  setText(elements.buildInfo, `Panel ${BUILD_VERSION} · lector ${contentVersion}`);
  if (contentVersion !== BUILD_VERSION) {
    setStatus("Lector actualizado automáticamente; vuelve a leer", "working");
  } else if (customerTurn) {
    setStatus("Solicitud del cliente identificada", "ready");
  } else if (inbound > 0) {
    setStatus("Conversación lista", "ready");
  } else if (messages.length > 0) {
    setStatus("Lectura parcial: revisa los mensajes sin clasificar", "error");
  } else {
    setStatus("No se encontraron mensajes de texto visibles", "error");
  }
}

function clearContext(errorMessage) {
  state.context = null;
  setText(elements.chatTitle, "Ninguna seleccionada");
  setText(elements.contextSummary, errorMessage);
  setHidden(elements.customerTurnCard, true);
  setHtml(elements.messageList, "");
  setStatus("No se pudo leer el chat", "error");
}

function updateDraftButtons() {
  const text = elements.draftText?.value ?? "";
  const hasText = Boolean(text.trim());
  setDisabled(elements.insertButton, !hasText);
  setDisabled(elements.sendButton, !hasText);
}

async function refreshContext() {
  setStatus("Leyendo conversación…", "working");
  setDisabled(elements.refreshButton, true);
  try {
    const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
    let context = await requestWhatsApp("READ_ACTIVE_CHAT", { maxMessages: settings.maxMessages });
    if (String(context?.buildVersion || "") !== BUILD_VERSION) {
      const tab = await getWhatsAppTab();
      await injectCurrentReader(tab.id);
      context = await chrome.tabs.sendMessage(tab.id, {
        type: "READ_ACTIVE_CHAT",
        payload: { maxMessages: settings.maxMessages },
      });
      if (context?.error) throw new Error(context.error);
    }
    renderContext(context);
  } catch (error) {
    clearContext(error?.message ?? String(error));
  } finally {
    setDisabled(elements.refreshButton, false);
  }
}

async function generateDraft() {
  if (!state.context) await refreshContext();
  if (!state.context) return;

  setDisabled(elements.generateButton, true);
  setStatus("Comprendiendo la solicitud…", "working");
  try {
    const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
    const hasBackend = Boolean(String(settings.backendUrl || "").trim() && String(settings.backendToken || "").trim());
    const result = hasBackend
      ? await requestBackground("GENERATE_DRAFT", { context: state.context })
      : localDraft(state.context, settings);
    state.draft = result.text;
    if (elements.draftText) elements.draftText.value = result.text;
    setText(elements.draftSource, result.source === "local-test" ? "Respuesta local" : "OpenAI");
    setWarning(result.warning || "");
    updateDraftButtons();
    setStatus("Respuesta lista para revisar", "ready");
  } catch (error) {
    setWarning(error?.message ?? String(error));
    setStatus("Error al generar la respuesta", "error");
  } finally {
    setDisabled(elements.generateButton, false);
  }
}

async function insertDraft() {
  const text = String(elements.draftText?.value ?? "").trim();
  if (!text) return;

  setDisabled(elements.insertButton, true);
  setStatus("Insertando respuesta…", "working");
  try {
    await requestWhatsApp("INSERT_DRAFT", { text });
    setStatus("Respuesta insertada; revisa y envía", "ready");
  } catch (error) {
    setWarning(error?.message ?? String(error));
    setStatus("No se pudo insertar", "error");
  } finally {
    updateDraftButtons();
  }
}

async function sendDraft() {
  const text = String(elements.draftText?.value ?? "").trim();
  if (!text) return;

  const confirmed = window.confirm(`¿Enviar este mensaje ahora a ${state.context?.chatTitle || "la conversación abierta"}?`);
  if (!confirmed) return;

  setDisabled(elements.sendButton, true);
  setStatus("Enviando respuesta…", "working");
  try {
    const result = await requestWhatsApp("SEND_DRAFT", { text });
    if (!result?.sent) throw new Error("WhatsApp no confirmó el envío.");
    setStatus("Mensaje enviado correctamente", "ready");
    setWarning("");
    setTimeout(refreshContext, 900);
  } catch (error) {
    setWarning(error?.message ?? String(error));
    setStatus("No se pudo enviar", "error");
  } finally {
    updateDraftButtons();
  }
}

function bindEvents() {
  elements.refreshButton?.addEventListener("click", refreshContext);
  elements.generateButton?.addEventListener("click", generateDraft);
  elements.insertButton?.addEventListener("click", insertDraft);
  elements.sendButton?.addEventListener("click", sendDraft);
  elements.settingsButton?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.draftText?.addEventListener("input", () => {
    state.draft = elements.draftText.value;
    updateDraftButtons();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "ACTIVE_CONTEXT_CHANGED" && message.payload) {
      try {
        renderContext(message.payload);
      } catch (error) {
        setWarning(`No se pudo actualizar el panel: ${error?.message ?? error}`);
      }
    }
  });
}

function init() {
  if (state.initialized) return;
  state.initialized = true;
  const missing = collectElements();
  if (missing.length) {
    renderFatalPanelError(missing);
    return;
  }
  setText(elements.versionText, `Versión ${BUILD_VERSION} de prueba supervisada`);
  setText(elements.buildInfo, `Panel ${BUILD_VERSION}`);
  bindEvents();
  updateDraftButtons();
  refreshContext();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
