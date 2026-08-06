(() => {
  const byId = (id) => document.getElementById(id);

  function pendingAppointment() {
    const card = byId("aiAnalysisCard");
    const nextAction = String(byId("aiNextAction")?.textContent || "")
      .trim()
      .toLowerCase()
      .replaceAll("_", " ");
    return !card?.hidden && nextAction === "reserve erp appointment";
  }

  function setStatus(text, kind = "idle") {
    if (byId("statusText")) byId("statusText").textContent = text;
    if (byId("statusDot")) byId("statusDot").dataset.kind = kind;
  }

  function setWarning(text) {
    if (byId("draftWarning")) byId("draftWarning").textContent = String(text || "");
  }

  function readableLabel(value) {
    return String(value || "—").replaceAll("_", " ");
  }

  function renderMetadata(metadata, source) {
    const card = byId("aiAnalysisCard");
    if (!metadata) {
      if (card) card.hidden = true;
      return;
    }
    if (card) {
      card.hidden = false;
      if (source === "openai" || source === "openai+erp") card.setAttribute("data-source", "openai");
      else card.removeAttribute("data-source");
    }
    if (byId("aiLanguage")) byId("aiLanguage").textContent = metadata.language || "—";
    if (byId("aiStage")) byId("aiStage").textContent = readableLabel(metadata.conversationStage);
    if (byId("aiNextAction")) byId("aiNextAction").textContent = readableLabel(metadata.nextAction);
    if (byId("aiConfidence")) {
      byId("aiConfidence").textContent = Number.isFinite(metadata.confidence)
        ? `${Math.round(metadata.confidence * 100)}%`
        : "—";
    }
    const collected = Object.entries(metadata.collectedInformation || {})
      .filter(([, value]) => String(value || "").trim())
      .map(([key, value]) => `${readableLabel(key)}: ${value}`);
    const scheduling = metadata.scheduling || {};
    const options = Array.isArray(scheduling.availabilityOptions) ? scheduling.availabilityOptions : [];
    if (options.length) collected.push(`Opciones ERP: ${options.map((option, index) => `${index + 1}) ${option.date} ${option.time}`).join(" · ")}`);
    if (scheduling.primaryWorkOrderId) collected.push(`Cita ERP: ${scheduling.primaryWorkOrderId}`);
    if (scheduling.routeZone) collected.push(`Sector: ${scheduling.routeZone}`);
    if (scheduling.vansRequired) collected.push(`Vans: ${scheduling.vansRequired}`);
    if (byId("aiCollected")) byId("aiCollected").textContent = collected.length ? collected.join(" · ") : "Ninguno todavía";
    const missing = Array.isArray(metadata.missingInformation) ? metadata.missingInformation : [];
    if (byId("aiMissing")) byId("aiMissing").textContent = missing.length ? missing.map(readableLabel).join(", ") : "Ninguna";
  }

  async function backgroundRequest(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.ok) throw new Error(response?.error || "La extensión no pudo completar la acción.");
    return response.result;
  }

  function synchronizeButtons() {
    const insertButton = byId("insertButton");
    if (insertButton && pendingAppointment()) {
      insertButton.disabled = true;
      insertButton.title = "La cita debe reservarse primero mediante Enviar ahora.";
    } else if (insertButton) {
      insertButton.removeAttribute("title");
    }
  }

  async function confirmAndSend(event) {
    if (!pendingAppointment()) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const chatTitle = byId("chatTitle")?.textContent || "la conversación abierta";
    if (!window.confirm(`¿Revalidar la disponibilidad, crear la cita en el ERP y enviar la confirmación a ${chatTitle}?`)) return;

    const sendButton = byId("sendButton");
    const insertButton = byId("insertButton");
    if (sendButton) sendButton.disabled = true;
    if (insertButton) insertButton.disabled = true;
    setStatus("Revalidando cupo y creando cita ERP…", "working");

    try {
      const context = await backgroundRequest("GET_ACTIVE_CONTEXT");
      const committed = await backgroundRequest("CONFIRM_APPOINTMENT", { context });
      const text = String(committed?.text || "").trim();
      if (byId("draftText")) byId("draftText").value = text;
      if (byId("draftSource")) byId("draftSource").textContent = committed?.source === "openai+erp" ? "OpenAI + ERP" : "OpenAI";
      setWarning(committed?.warning || "");
      renderMetadata(committed?.metadata, committed?.source);

      if (!committed?.metadata?.scheduling?.appointmentCreated) {
        setStatus("La disponibilidad cambió; revisa las nuevas opciones", "error");
        if (sendButton) sendButton.disabled = !text;
        synchronizeButtons();
        return;
      }
      if (!text) throw new Error("La cita fue creada, pero no se generó el mensaje de confirmación.");

      setStatus("Cita creada. Enviando confirmación…", "working");
      const sent = await backgroundRequest("SEND_DRAFT", { text });
      if (!sent?.sent) throw new Error("WhatsApp no confirmó el envío.");
      setWarning("");
      setStatus("Cita creada y mensaje enviado correctamente", "ready");
      if (sendButton) sendButton.disabled = false;
    } catch (error) {
      setWarning(error?.message || String(error));
      setStatus("No se pudo confirmar y enviar la cita", "error");
      if (sendButton) sendButton.disabled = false;
      synchronizeButtons();
    }
  }

  function blockUnsafeInsert(event) {
    if (!pendingAppointment()) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    setWarning("Esta confirmación no se puede insertar manualmente. Usa Enviar ahora para revalidar el cupo y crear la cita antes de mandar el mensaje.");
    setStatus("La cita debe reservarse antes de enviar la confirmación", "error");
  }

  function init() {
    byId("sendButton")?.addEventListener("click", confirmAndSend, true);
    byId("insertButton")?.addEventListener("click", blockUnsafeInsert, true);
    const observer = new MutationObserver(synchronizeButtons);
    if (byId("aiNextAction")) observer.observe(byId("aiNextAction"), { childList: true, characterData: true, subtree: true });
    if (byId("aiAnalysisCard")) observer.observe(byId("aiAnalysisCard"), { attributes: true, attributeFilter: ["hidden"] });
    synchronizeButtons();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
