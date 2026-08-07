(() => {
  const byId = (id) => document.getElementById(id);
  const AUTO_TEST_TTL_MS = 8 * 60 * 60 * 1000;
  const POLL_MS = 1100;
  const SETTLE_MS = 1600;

  let currentStatus = { enabled: false };
  let pollTimer = null;
  let settleTimer = null;
  let processing = false;
  let lastHandledFingerprint = "";
  let pendingFingerprint = "";
  let boundConversationKey = "";

  async function backgroundRequest(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.ok) throw new Error(response?.error || "La extensión no pudo completar la acción.");
    return response.result;
  }

  function cleanText(value, maxLength = 1000) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function normalizeText(value) {
    return cleanText(value, 300)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function conversationKey(context) {
    for (const message of context?.messages || []) {
      const match = String(message?.id || "").match(/(?:^|_)(\d{7,20})@(c\.us|s\.whatsapp\.net)(?:_|$)/i);
      if (match) return `phone:${match[1]}`;
    }
    const title = normalizeText(context?.chatTitle)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return title ? `chat:${title}` : "chat:unknown";
  }

  function latestMessage(context) {
    const messages = Array.isArray(context?.messages) ? context.messages : [];
    return messages.length ? messages[messages.length - 1] : null;
  }

  function latestInboundFingerprint(context) {
    const last = latestMessage(context);
    if (!last || last.direction !== "inbound") return "";
    const groupedIds = Array.isArray(context?.customerTurn?.messageIds)
      ? context.customerTurn.messageIds.filter(Boolean).join(",")
      : "";
    return [
      conversationKey(context),
      cleanText(last.id, 180),
      groupedIds,
      cleanText(context?.customerTurn?.text || last.text, 1000),
    ].join("|");
  }

  function setMainStatus(text, kind = "idle") {
    if (byId("statusText")) byId("statusText").textContent = String(text || "");
    if (byId("statusDot")) byId("statusDot").dataset.kind = kind;
  }

  function setWarning(text) {
    if (byId("draftWarning")) byId("draftWarning").textContent = String(text || "");
  }

  function expiryLabel(value) {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("es-AW", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  }

  function renderStatus(status) {
    currentStatus = status || { enabled: false };
    const enabled = Boolean(currentStatus.enabled);
    const card = byId("autoTestCard");
    const badge = byId("autoTestBadge");
    const button = byId("autoTestButton");
    const statusText = byId("autoTestStatus");
    const detail = byId("autoTestDetail");

    if (card) card.dataset.kind = enabled ? (currentStatus.processing ? "working" : "ready") : "idle";
    if (badge) badge.textContent = enabled ? (currentStatus.processing ? "Procesando" : "ACTIVO") : "Desactivado";
    if (button) {
      button.textContent = enabled ? "Desactivar modo automático" : "Activar para este chat";
      button.className = enabled ? "danger-button" : "primary-button";
    }
    if (statusText) {
      statusText.textContent = enabled
        ? `Activo únicamente para: ${currentStatus.chatTitle || "chat de prueba"}.`
        : "Actívalo únicamente dentro de tu chat de prueba. Se vincula solo a esa conversación.";
    }
    if (detail) {
      const expires = expiryLabel(currentStatus.expiresAt);
      detail.textContent = enabled
        ? `El panel está vigilando únicamente este chat y generará + enviará cada respuesta nueva.${expires ? ` Se desactiva cerca de ${expires}, al cerrar el panel o al recargar la extensión.` : ""}`
        : "Generará y enviará las respuestas automáticamente. Si el cliente confirma una cita, también revalidará y creará la orden real en el ERP.";
    }
  }

  function showAutomaticDraft(result) {
    const draft = String(result?.text || result?.draft || "").trim();
    if (draft && byId("draftText")) {
      byId("draftText").value = draft;
      byId("draftText").dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (draft && byId("draftSource")) byId("draftSource").textContent = "Automático · OpenAI + ERP";
    if (result?.warning) setWarning(result.warning);
  }

  function requiresHumanReview(result) {
    return result?.metadata?.requiresHuman === true
      || result?.metadata?.nextAction === "transfer_human";
  }

  function stopTimers() {
    if (pollTimer) window.clearInterval(pollTimer);
    if (settleTimer) window.clearTimeout(settleTimer);
    pollTimer = null;
    settleTimer = null;
    pendingFingerprint = "";
  }

  function disableAutoMode(message = "Modo automático de prueba desactivado") {
    stopTimers();
    processing = false;
    boundConversationKey = "";
    lastHandledFingerprint = "";
    renderStatus({ enabled: false });
    setMainStatus(message, "ready");
  }

  function statusExpired() {
    const expiry = Date.parse(currentStatus.expiresAt || "");
    return currentStatus.enabled && Number.isFinite(expiry) && expiry <= Date.now();
  }

  async function processTurn(expectedFingerprint) {
    if (!currentStatus.enabled || processing) return;
    processing = true;
    renderStatus({ ...currentStatus, processing: true });
    setMainStatus(`Analizando automáticamente el último mensaje de ${currentStatus.chatTitle || "este chat"}…`, "working");

    try {
      let context = await backgroundRequest("GET_ACTIVE_CONTEXT");
      if (conversationKey(context) !== boundConversationKey) {
        setMainStatus("El chat abierto cambió. El modo automático sigue vinculado al chat de prueba y no enviará aquí.", "ready");
        return;
      }
      let fingerprint = latestInboundFingerprint(context);
      if (!fingerprint || fingerprint !== expectedFingerprint || fingerprint === lastHandledFingerprint) return;

      let result = await backgroundRequest("GENERATE_DRAFT", { context });
      showAutomaticDraft(result);
      if (requiresHumanReview(result)) {
        lastHandledFingerprint = fingerprint;
        setMainStatus("La IA solicitó revisión humana. No se envió ningún mensaje automáticamente.", "error");
        return;
      }

      if (result?.metadata?.nextAction === "reserve_erp_appointment") {
        setMainStatus("El cliente seleccionó una cita. Revalidando cupo y creando la orden en el ERP…", "working");
        result = await backgroundRequest("CONFIRM_APPOINTMENT", { context });
        showAutomaticDraft(result);
        if (requiresHumanReview(result) || result?.metadata?.nextAction === "reserve_erp_appointment") {
          lastHandledFingerprint = fingerprint;
          setMainStatus("La cita no pudo confirmarse automáticamente. Se detuvo el envío para revisión.", "error");
          return;
        }
      }

      const freshContext = await backgroundRequest("GET_ACTIVE_CONTEXT");
      if (conversationKey(freshContext) !== boundConversationKey) {
        setMainStatus("El chat cambió mientras la IA respondía. Se descartó el borrador y no se envió.", "error");
        return;
      }
      const freshFingerprint = latestInboundFingerprint(freshContext);
      if (freshFingerprint !== fingerprint) {
        setMainStatus("Llegó un mensaje nuevo mientras la IA respondía. Se descartó el borrador anterior.", "working");
        pendingFingerprint = freshFingerprint;
        if (settleTimer) window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
          settleTimer = null;
          if (pendingFingerprint) void processTurn(pendingFingerprint);
        }, SETTLE_MS);
        return;
      }

      setMainStatus("Respuesta generada. Enviando automáticamente por WhatsApp…", "working");
      const sent = await backgroundRequest("SEND_DRAFT", { text: result.text });
      if (!sent?.sent) throw new Error("WhatsApp no confirmó el envío automático.");
      lastHandledFingerprint = fingerprint;
      setWarning("");
      setMainStatus("Respuesta automática enviada correctamente", "ready");
    } catch (error) {
      const detail = error?.message || String(error);
      setWarning(detail);
      setMainStatus(`Error en respuesta automática: ${detail}`, "error");
    } finally {
      processing = false;
      if (currentStatus.enabled) renderStatus({ ...currentStatus, processing: false });
    }
  }

  async function pollForNewInbound() {
    if (!currentStatus.enabled || processing) return;
    if (statusExpired()) {
      disableAutoMode("El modo automático expiró después de 8 horas y fue desactivado.");
      return;
    }

    try {
      const context = await backgroundRequest("GET_ACTIVE_CONTEXT");
      if (conversationKey(context) !== boundConversationKey) return;
      const fingerprint = latestInboundFingerprint(context);
      if (!fingerprint || fingerprint === lastHandledFingerprint || fingerprint === pendingFingerprint) return;

      pendingFingerprint = fingerprint;
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        const target = pendingFingerprint;
        settleTimer = null;
        pendingFingerprint = "";
        if (target) void processTurn(target);
      }, SETTLE_MS);
    } catch (error) {
      setMainStatus(`No se pudo leer el chat para respuesta automática: ${error?.message || String(error)}`, "error");
    }
  }

  async function toggleAutoMode() {
    const button = byId("autoTestButton");
    if (button) button.disabled = true;
    try {
      if (currentStatus.enabled) {
        disableAutoMode();
        return;
      }

      const context = await backgroundRequest("GET_ACTIVE_CONTEXT");
      const key = conversationKey(context);
      if (!key || key === "chat:unknown") throw new Error("No se pudo identificar de forma segura la conversación abierta.");
      const chatTitle = String(context?.chatTitle || "esta conversación").trim();
      const accepted = window.confirm(
        `¿Activar respuestas automáticas únicamente para ${chatTitle}?\n\n`
        + "La IA generará y enviará mensajes sin confirmación manual. Si durante la prueba se confirma una cita, se puede crear una orden REAL en la agenda del ERP.\n\n"
        + "El modo funcionará mientras este panel permanezca abierto y expirará después de 8 horas.",
      );
      if (!accepted) return;

      boundConversationKey = key;
      lastHandledFingerprint = latestInboundFingerprint(context);
      pendingFingerprint = "";
      const enabledAt = new Date();
      const expiresAt = new Date(enabledAt.getTime() + AUTO_TEST_TTL_MS);
      renderStatus({
        enabled: true,
        processing: false,
        chatTitle,
        enabledAt: enabledAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      setWarning("");
      setMainStatus(`Modo automático activo para ${chatTitle}. Esperando el próximo mensaje del cliente…`, "ready");
      stopTimers();
      pollTimer = window.setInterval(() => void pollForNewInbound(), POLL_MS);
    } catch (error) {
      const detail = error?.message || String(error);
      setWarning(detail);
      setMainStatus(`No se pudo activar: ${detail}`, "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  function init() {
    byId("autoTestButton")?.addEventListener("click", toggleAutoMode);
    renderStatus({ enabled: false });
    window.addEventListener("beforeunload", stopTimers);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();