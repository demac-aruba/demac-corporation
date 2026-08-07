(() => {
  const byId = (id) => document.getElementById(id);
  let currentStatus = { enabled: false };

  async function backgroundRequest(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.ok) throw new Error(response?.error || "La extensión no pudo completar la acción.");
    return response.result;
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
        ? `Genera y envía automáticamente. También puede crear citas reales en el ERP cuando el cliente confirma una opción.${expires ? ` Se desactiva automáticamente cerca de ${expires} o al cerrar Chrome.` : " Se desactiva al cerrar Chrome."}`
        : "Generará y enviará las respuestas automáticamente. Si el cliente confirma una cita, también revalidará y creará la orden real en el ERP.";
    }
  }

  function showAutomaticDraft(payload) {
    const draft = String(payload?.draft || "").trim();
    if (draft && byId("draftText")) {
      byId("draftText").value = draft;
      byId("draftText").dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (draft && byId("draftSource")) byId("draftSource").textContent = "Automático · OpenAI + ERP";
    const warning = payload?.result?.warning || payload?.error || "";
    if (warning) setWarning(warning);
  }

  async function toggleAutoMode() {
    const button = byId("autoTestButton");
    if (button) button.disabled = true;
    try {
      if (currentStatus.enabled) {
        const status = await backgroundRequest("DISABLE_AUTO_TEST_MODE");
        renderStatus(status);
        setMainStatus("Modo automático de prueba desactivado", "ready");
        return;
      }

      const context = await backgroundRequest("GET_ACTIVE_CONTEXT");
      const chatTitle = String(context?.chatTitle || "esta conversación").trim();
      const accepted = window.confirm(
        `¿Activar respuestas automáticas únicamente para ${chatTitle}?\n\n`
        + "La IA generará y enviará mensajes sin confirmación manual. Si durante la prueba se confirma una cita, se puede crear una orden REAL en la agenda del ERP.\n\n"
        + "Este modo se desactiva al cerrar Chrome o después de 8 horas.",
      );
      if (!accepted) return;

      const status = await backgroundRequest("ENABLE_AUTO_TEST_MODE", { context });
      renderStatus(status);
      setWarning("");
      setMainStatus(`Modo automático activo para ${status.chatTitle || chatTitle}`, "ready");
    } catch (error) {
      setWarning(error?.message || String(error));
      setMainStatus("No se pudo cambiar el modo automático", "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function refreshStatus() {
    try {
      const status = await backgroundRequest("GET_AUTO_TEST_STATUS");
      renderStatus(status);
    } catch (_error) {
      renderStatus({ enabled: false });
    }
  }

  function handleRuntimeMessage(message) {
    if (message?.type !== "AUTO_TEST_EVENT" || !message.payload) return;
    renderStatus(message.payload.status || currentStatus);
    showAutomaticDraft(message.payload);
    if (message.payload.message) {
      const kind = message.payload.error
        ? "error"
        : message.payload.status?.processing
          ? "working"
          : "ready";
      setMainStatus(message.payload.message, kind);
    }
  }

  function init() {
    byId("autoTestButton")?.addEventListener("click", toggleAutoMode);
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    refreshStatus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
