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

  if (inbound > 0) setStatus("Conversación lista", "ready");
  else setStatus("Lectura parcial: no se detectaron recibidos", "error");
}

function clearContext(errorMessage) {
  state.context = null;
  elements.chatTitle.textContent = "Ninguna seleccionada";
  elements.contextSummary.textContent = errorMessage;
  elements.customerTurnCard.hidden = true;
  elements.messageList.innerHTML = "";
  setStatus("No se pudo leer el chat", "error");
}

async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.ok) throw new Error(response?.error ?? "La extensión no pudo completar la acción.");
  if (response.result?.error) throw new Error(response.result.error);
  return response.result;
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
    const context = await request("GET_ACTIVE_CONTEXT");
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
    const result = await request("GENERATE_DRAFT", { context: state.context });
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
    await request("INSERT_DRAFT", { text });
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
    const result = await request("SEND_DRAFT", { text });
    setStatus(`Mensaje enviado${result?.method ? ` mediante ${result.method}` : ""}`, "ready");
    elements.draftWarning.textContent = "";
    setTimeout(refreshContext, 800);
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
elements.settingsButton.addEventListener("click", () => request("OPEN_OPTIONS"));
elements.draftText.addEventListener("input", () => {
  state.draft = elements.draftText.value;
  updateDraftButtons();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "ACTIVE_CONTEXT_CHANGED" && message.payload) renderContext(message.payload);
});

refreshContext();
