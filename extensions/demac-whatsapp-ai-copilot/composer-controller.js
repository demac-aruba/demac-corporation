(() => {
  const BUILD_VERSION = chrome.runtime.getManifest().version;
  const legacy = window.__DEMAC_WHATSAPP_COPILOT__;
  const readActiveChat = typeof legacy?.readActiveChat === "function"
    ? legacy.readActiveChat.bind(legacy)
    : null;

  legacy?.dispose?.();

  const STATE = {
    observer: null,
    debounceTimer: null,
    lastFingerprint: "",
  };

  function normalizeWhitespace(value) {
    return String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
  }

  function normalizedForComparison(value) {
    return normalizeWhitespace(value)
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n")
      .trim();
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== "none"
      && style.visibility !== "hidden";
  }

  function findComposer() {
    const footer = document.querySelector("#main footer") ?? document.querySelector("footer");
    if (!footer) return null;
    return footer.querySelector("div[contenteditable='true'][role='textbox']")
      ?? footer.querySelector("div[contenteditable='true'][data-tab]")
      ?? footer.querySelector("div[contenteditable='true']");
  }

  function selectComposerContents(composer) {
    composer.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function clearComposer(composer) {
    selectComposerContents(composer);
    try {
      document.execCommand("delete", false);
    } catch (_error) {
      // Continue with the DOM fallback.
    }
    if (normalizedForComparison(composer.innerText || composer.textContent)) {
      composer.replaceChildren();
      composer.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "deleteContentBackward",
        data: null,
      }));
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function htmlForDraft(draft) {
    const lines = normalizeWhitespace(draft).split("\n");
    return lines.map((line) => line ? escapeHtml(line) : "<br>").join("<br>");
  }

  function draftWasInserted(composer, draft) {
    const actual = normalizedForComparison(composer.innerText || composer.textContent);
    const expected = normalizedForComparison(draft);
    if (!actual || !expected) return false;

    const expectedLines = expected.split("\n").filter((line) => line.trim());
    let cursor = 0;
    for (const line of expectedLines) {
      const index = actual.indexOf(line, cursor);
      if (index < 0) return false;
      cursor = index + line.length;
    }

    if (expected.includes("\n") && !actual.includes("\n")) return false;
    return true;
  }

  async function tryPasteEvent(composer, draft) {
    if (typeof DataTransfer !== "function" || typeof ClipboardEvent !== "function") return false;
    clearComposer(composer);
    composer.focus();
    const transfer = new DataTransfer();
    transfer.setData("text/plain", draft);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    });
    composer.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return draftWasInserted(composer, draft);
  }

  async function tryInsertHtml(composer, draft) {
    clearComposer(composer);
    selectComposerContents(composer);
    let inserted = false;
    try {
      inserted = document.execCommand("insertHTML", false, htmlForDraft(draft));
    } catch (_error) {
      inserted = false;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    return Boolean(inserted) && draftWasInserted(composer, draft);
  }

  async function tryNativeLineInsertion(composer, draft) {
    clearComposer(composer);
    composer.focus();
    const lines = normalizeWhitespace(draft).split("\n");
    try {
      if (!document.execCommand("insertText", false, lines[0])) return false;
      for (let index = 1; index < lines.length; index += 1) {
        const brokeLine = document.execCommand("insertLineBreak", false)
          || document.execCommand("insertHTML", false, "<br>");
        if (!brokeLine) return false;
        if (lines[index] && !document.execCommand("insertText", false, lines[index])) return false;
      }
    } catch (_error) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    return draftWasInserted(composer, draft);
  }

  async function tryDomInput(composer, draft) {
    clearComposer(composer);
    const fragment = document.createDocumentFragment();
    const lines = normalizeWhitespace(draft).split("\n");
    lines.forEach((line, index) => {
      if (index) fragment.appendChild(document.createElement("br"));
      if (line) fragment.appendChild(document.createTextNode(line));
    });
    composer.replaceChildren(fragment);
    composer.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertFromPaste",
      data: draft,
    }));
    composer.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertFromPaste",
      data: draft,
    }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    return draftWasInserted(composer, draft);
  }

  async function replaceComposerText(text) {
    const draft = normalizeWhitespace(text).trim();
    if (!draft) throw new Error("El borrador está vacío.");

    const composer = findComposer();
    if (!composer) throw new Error("No se encontró el campo para escribir el mensaje.");

    const strategies = [tryPasteEvent, tryInsertHtml, tryNativeLineInsertion, tryDomInput];
    for (const strategy of strategies) {
      if (await strategy(composer, draft)) {
        composer.focus();
        return composer;
      }
    }

    clearComposer(composer);
    throw new Error("WhatsApp no aceptó el borrador. No se insertó ni se pulsó ningún botón para evitar activar el micrófono.");
  }

  function isMicrophoneControl(element) {
    const text = `${element?.getAttribute?.("aria-label") || ""} ${element?.textContent || ""}`.toLowerCase();
    return /microphone|micrófono|microfono|voice message|mensaje de voz|record/.test(text)
      || Boolean(element?.querySelector?.("[data-icon='ptt'], [data-icon='mic'], [data-icon='microphone']"));
  }

  function isExplicitSendControl(element) {
    if (!element || !isVisible(element) || isMicrophoneControl(element)) return false;
    const label = String(element.getAttribute?.("aria-label") || "").toLowerCase();
    return label === "send"
      || label === "enviar"
      || Boolean(element.querySelector?.("[data-icon='send'], svg[aria-label='Send'], svg[aria-label='Enviar']"))
      || element.getAttribute?.("data-testid") === "compose-btn-send";
  }

  function findSendButton(composer) {
    const footer = composer.closest("footer") ?? document.querySelector("#main footer") ?? document.querySelector("footer");
    if (!footer) return null;
    const candidates = [
      ...footer.querySelectorAll("button[aria-label='Send'], button[aria-label='Enviar'], [data-testid='compose-btn-send'], button, [role='button']"),
    ];
    for (const candidate of candidates) {
      const clickable = candidate.closest("button, [role='button']") ?? candidate;
      if (isExplicitSendControl(clickable)) return clickable;
    }
    return null;
  }

  async function waitForSendButton(composer, timeoutMs = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const button = findSendButton(composer);
      if (button) return button;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  }

  async function waitForComposerToClear(composer, timeoutMs = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!normalizedForComparison(composer.innerText || composer.textContent)) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  async function insertDraft(text) {
    await replaceComposerText(text);
    return { inserted: true, sent: false, buildVersion: BUILD_VERSION };
  }

  async function sendDraft(text) {
    const composer = await replaceComposerText(text);
    const sendButton = await waitForSendButton(composer);
    if (!sendButton) {
      throw new Error("El borrador quedó insertado, pero WhatsApp no mostró un botón Enviar verificable. No se pulsó el micrófono ni ningún botón alternativo.");
    }
    if (!isExplicitSendControl(sendButton)) {
      throw new Error("El control encontrado no era el botón Enviar. El mensaje quedó insertado para revisión manual.");
    }

    sendButton.click();
    if (!await waitForComposerToClear(composer)) {
      throw new Error("WhatsApp no confirmó el envío. El texto permanece en el campo y no se pulsará ningún otro control.");
    }
    return { inserted: true, sent: true, method: "verified-send-button", buildVersion: BUILD_VERSION };
  }

  function notifyContextChanged() {
    clearTimeout(STATE.debounceTimer);
    STATE.debounceTimer = setTimeout(() => {
      if (!readActiveChat) return;
      try {
        const context = readActiveChat(12);
        const last = context.messages?.at?.(-1);
        const fingerprint = `${context.chatTitle}|${last?.id ?? ""}|${last?.direction ?? ""}|${last?.text ?? ""}`;
        if (!fingerprint || fingerprint === STATE.lastFingerprint) return;
        STATE.lastFingerprint = fingerprint;
        chrome.runtime.sendMessage({ type: "ACTIVE_CONTEXT_CHANGED", payload: context }).catch(() => undefined);
      } catch (_error) {
        // The chat may be changing while WhatsApp updates its DOM.
      }
    }, 900);
  }

  const messageListener = (message, _sender, sendResponse) => {
    const run = async () => {
      switch (message?.type) {
        case "PING_CONTENT":
          return { buildVersion: BUILD_VERSION };
        case "READ_ACTIVE_CHAT":
          if (!readActiveChat) throw new Error("El lector del chat no está disponible.");
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
    readActiveChat,
    insertDraft,
    sendDraft,
    dispose() {
      clearTimeout(STATE.debounceTimer);
      STATE.observer?.disconnect();
      chrome.runtime.onMessage.removeListener(messageListener);
    },
  };

  notifyContextChanged();
})();
