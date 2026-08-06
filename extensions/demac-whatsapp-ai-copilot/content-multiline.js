(() => {
  const BUILD_VERSION = chrome.runtime.getManifest().version;
  const previous = window.__DEMAC_WHATSAPP_COPILOT__;
  if (!previous?.readActiveChat || !previous?.dispose) return;

  const readActiveChat = previous.readActiveChat;
  previous.dispose();

  const STATE = {
    observer: null,
    debounceTimer: null,
    lastFingerprint: "",
  };

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function findComposer() {
    const footer = document.querySelector("#main footer") ?? document.querySelector("footer");
    if (!footer) return null;
    return footer.querySelector("div[contenteditable='true'][role='textbox']")
      ?? footer.querySelector("div[contenteditable='true'][data-tab]")
      ?? footer.querySelector("div[contenteditable='true']");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function composerHtml(value) {
    return escapeHtml(value)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n/g, "<br>");
  }

  function selectComposerContents(composer) {
    composer.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function replaceComposerText(text) {
    const draft = String(text ?? "").trim();
    if (!draft) throw new Error("El borrador está vacío.");

    const composer = findComposer();
    if (!composer) throw new Error("No se encontró el campo para escribir el mensaje.");

    selectComposerContents(composer);

    let inserted = false;
    try {
      inserted = document.execCommand("insertHTML", false, composerHtml(draft));
    } catch (_error) {
      inserted = false;
    }

    if (!inserted) {
      composer.replaceChildren();
      const lines = draft.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      lines.forEach((line, index) => {
        if (index > 0) composer.appendChild(document.createElement("br"));
        if (line) composer.appendChild(document.createTextNode(line));
      });
      composer.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertFromPaste",
        data: draft,
      }));
    }

    composer.dispatchEvent(new Event("change", { bubbles: true }));
    return composer;
  }

  function findSendButton(composer) {
    const footer = composer.closest("footer") ?? document.querySelector("#main footer") ?? document.querySelector("footer");
    if (!footer) return null;

    const selectors = [
      "button[aria-label='Send']",
      "button[aria-label='Enviar']",
      "[data-testid='compose-btn-send']",
      "button span[data-icon='send']",
      "[role='button'] span[data-icon='send']",
      "span[data-icon='send']",
      "svg[aria-label='Send']",
      "svg[aria-label='Enviar']",
    ];

    for (const selector of selectors) {
      const element = footer.querySelector(selector);
      if (!element || !isVisible(element)) continue;
      const clickable = element.closest("button, [role='button']") ?? element;
      if (isVisible(clickable)) return clickable;
    }

    const composerRect = composer.getBoundingClientRect();
    const candidates = [...footer.querySelectorAll("button, [role='button']")]
      .filter(isVisible)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.left >= composerRect.right - 20 && rect.width >= 24 && rect.height >= 24)
      .sort((a, b) => b.rect.left - a.rect.left);
    return candidates[0]?.element ?? null;
  }

  function clickElement(element) {
    const options = { bubbles: true, cancelable: true, composed: true, view: window };
    element.dispatchEvent(new PointerEvent("pointerdown", options));
    element.dispatchEvent(new MouseEvent("mousedown", options));
    element.dispatchEvent(new PointerEvent("pointerup", options));
    element.dispatchEvent(new MouseEvent("mouseup", options));
    element.click();
  }

  async function waitForComposerToClear(composer, timeoutMs = 2500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!normalizeText(composer.textContent)) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  function insertDraft(text) {
    replaceComposerText(text);
    return { inserted: true, sent: false, multiline: true, buildVersion: BUILD_VERSION };
  }

  async function sendDraft(text) {
    const composer = replaceComposerText(text);
    await new Promise((resolve) => setTimeout(resolve, 220));
    const sendButton = findSendButton(composer);
    if (!sendButton) throw new Error("No se encontró el botón verde de enviar en esta versión de WhatsApp Web.");

    clickElement(sendButton);
    const cleared = await waitForComposerToClear(composer);
    if (!cleared) {
      throw new Error("WhatsApp no confirmó el envío. El texto permanece en el campo para que puedas enviarlo manualmente.");
    }
    return { inserted: true, sent: true, multiline: true, method: "send-button", buildVersion: BUILD_VERSION };
  }

  function notifyContextChanged() {
    clearTimeout(STATE.debounceTimer);
    STATE.debounceTimer = setTimeout(() => {
      try {
        const context = readActiveChat(12);
        const last = context.messages.at(-1);
        const fingerprint = `${context.chatTitle}|${last?.id ?? ""}|${last?.direction ?? ""}|${last?.text ?? ""}`;
        if (!fingerprint || fingerprint === STATE.lastFingerprint) return;
        STATE.lastFingerprint = fingerprint;
        chrome.runtime.sendMessage({ type: "ACTIVE_CONTEXT_CHANGED", payload: context }).catch(() => undefined);
      } catch (_error) {
      }
    }, 900);
  }

  const messageListener = (message, _sender, sendResponse) => {
    const run = async () => {
      switch (message?.type) {
        case "PING_CONTENT":
          return { buildVersion: BUILD_VERSION, multiline: true };
        case "READ_ACTIVE_CHAT":
          return readActiveChat(message.payload?.maxMessages);
        case "INSERT_DRAFT":
          return insertDraft(message.payload?.text);
        case "SEND_DRAFT":
        case "SEND_NOW":
        case "SEND_MESSAGE":
          return sendDraft(message.payload?.text);
        default:
          return { ignored: true, buildVersion: BUILD_VERSION };
      }
    };

    run().then(
      (result) => sendResponse(result),
      (error) => sendResponse({ error: error?.message ?? String(error), buildVersion: BUILD_VERSION }),
    );
    return true;
  };

  chrome.runtime.onMessage.addListener(messageListener);

  STATE.observer = new MutationObserver(notifyContextChanged);
  STATE.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.__DEMAC_WHATSAPP_COPILOT__ = {
    version: BUILD_VERSION,
    multiline: true,
    readActiveChat,
    dispose() {
      clearTimeout(STATE.debounceTimer);
      STATE.observer?.disconnect();
      chrome.runtime.onMessage.removeListener(messageListener);
    },
  };

  notifyContextChanged();
})();
