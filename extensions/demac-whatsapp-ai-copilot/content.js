(() => {
  const STATE = {
    lastFingerprint: "",
    observer: null,
    debounceTimer: null,
  };

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function findMainPanel() {
    return document.querySelector("#main") ?? document.querySelector("[role='main']");
  }

  function findChatTitle(main) {
    const candidates = [
      "header [data-testid='conversation-info-header-chat-title']",
      "header span[title]",
      "header span[dir='auto']",
      "header [role='button'] span",
    ];
    for (const selector of candidates) {
      const element = main?.querySelector(selector);
      const title = normalizeText(element?.getAttribute("title") || element?.textContent);
      if (title) return title;
    }
    return "";
  }

  function messageContainerFor(element, main) {
    const container = element.closest(
      ".message-in, .message-out, [data-testid='msg-container'], [data-id]",
    );
    return container && main.contains(container) ? container : null;
  }

  function candidateMessageContainers(main) {
    const containers = [];
    const seen = new Set();
    const textNodes = main.querySelectorAll(
      "span.selectable-text, [data-testid='msg-text'], [data-pre-plain-text]",
    );

    for (const textNode of textNodes) {
      const container = messageContainerFor(textNode, main);
      if (!container || seen.has(container)) continue;
      seen.add(container);
      containers.push(container);
    }

    if (!containers.length) {
      for (const container of main.querySelectorAll(".message-in, .message-out, [data-id]")) {
        if (seen.has(container)) continue;
        seen.add(container);
        containers.push(container);
      }
    }

    return containers.sort((a, b) => {
      if (a === b) return 0;
      const position = a.compareDocumentPosition(b);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function textFromMessageNode(node) {
    const selectable = node.querySelectorAll("span.selectable-text, [data-testid='msg-text']");
    const pieces = [...selectable]
      .map((element) => normalizeText(element.textContent))
      .filter(Boolean);
    if (pieces.length) return [...new Set(pieces)].join("\n");

    const copyable = node.matches("[data-pre-plain-text]")
      ? node
      : node.querySelector("[data-pre-plain-text]");
    return normalizeText(copyable?.textContent);
  }

  function nearestDataId(node) {
    return node.getAttribute?.("data-id")
      || node.closest?.("[data-id]")?.getAttribute("data-id")
      || "";
  }

  function directionFromDataId(dataId) {
    const value = String(dataId || "");
    if (/^(true|1)_/i.test(value) || /_true_/i.test(value)) return "outbound";
    if (/^(false|0)_/i.test(value) || /_false_/i.test(value)) return "inbound";
    return "unknown";
  }

  function directionFromMetadata(node) {
    const metadata = node.matches("[data-pre-plain-text]")
      ? node.getAttribute("data-pre-plain-text")
      : node.querySelector("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text");
    const aria = normalizeText(node.getAttribute?.("aria-label") || node.textContent).toLocaleLowerCase();
    const meta = normalizeText(metadata).toLocaleLowerCase();

    if (/\b(you|tú|tu|vos|demac)\s*:/i.test(meta) || /^you\b|^tú\b|^demac\b/i.test(aria)) {
      return "outbound";
    }
    return "unknown";
  }

  function directionFromPosition(node, main) {
    const nodeRect = node.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    if (!nodeRect.width || !mainRect.width) return "unknown";

    const center = nodeRect.left + (nodeRect.width / 2);
    const relative = (center - mainRect.left) / mainRect.width;
    if (relative >= 0.57) return "outbound";
    if (relative <= 0.48) return "inbound";
    return "unknown";
  }

  function directionFromNode(node, main) {
    const classContainer = node.closest(".message-in, .message-out")
      ?? node.querySelector(".message-in, .message-out");
    if (classContainer?.classList.contains("message-in")) {
      return { direction: "inbound", method: "class" };
    }
    if (classContainer?.classList.contains("message-out")) {
      return { direction: "outbound", method: "class" };
    }

    const byId = directionFromDataId(nearestDataId(node));
    if (byId !== "unknown") return { direction: byId, method: "data-id" };

    const byMetadata = directionFromMetadata(node);
    if (byMetadata !== "unknown") return { direction: byMetadata, method: "metadata" };

    const byPosition = directionFromPosition(node, main);
    if (byPosition !== "unknown") return { direction: byPosition, method: "position" };

    return { direction: "unknown", method: "unresolved" };
  }

  function extractMessages(main, maxMessages) {
    const messages = [];
    const fingerprints = new Set();

    for (const node of candidateMessageContainers(main)) {
      const text = textFromMessageNode(node);
      if (!text) continue;

      const id = nearestDataId(node);
      const { direction, method } = directionFromNode(node, main);
      const fingerprint = `${direction}:${id}:${text}`;
      if (fingerprints.has(fingerprint)) continue;
      fingerprints.add(fingerprint);

      messages.push({ id, direction, directionMethod: method, text });
    }

    return messages.slice(-Math.max(1, Math.min(Number(maxMessages) || 20, 50)));
  }

  function latestCustomerTurn(messages) {
    const lastInboundIndex = [...messages]
      .map((message) => message.direction)
      .lastIndexOf("inbound");
    if (lastInboundIndex < 0) return { text: "", count: 0, messageIds: [] };

    let start = lastInboundIndex;
    while (start > 0 && messages[start - 1].direction === "inbound") start -= 1;
    const turn = messages.slice(start, lastInboundIndex + 1).filter((message) => message.text);
    return {
      text: turn.map((message) => message.text).join("\n"),
      count: turn.length,
      messageIds: turn.map((message) => message.id).filter(Boolean),
    };
  }

  function readActiveChat(maxMessages = 20) {
    const main = findMainPanel();
    if (!main) throw new Error("Selecciona una conversación en WhatsApp Web.");

    const chatTitle = findChatTitle(main);
    const messages = extractMessages(main, maxMessages);
    const customerTurn = latestCustomerTurn(messages);
    const diagnostic = messages.reduce((result, message) => {
      result[message.directionMethod] = (result[message.directionMethod] || 0) + 1;
      return result;
    }, {});

    return {
      chatTitle,
      messages,
      customerTurn,
      diagnostic,
      pageUrl: location.href,
      capturedAt: new Date().toISOString(),
      scope: "active-chat-only",
    };
  }

  function findComposer() {
    const footer = document.querySelector("#main footer") ?? document.querySelector("footer");
    if (!footer) return null;
    return footer.querySelector("div[contenteditable='true'][role='textbox']")
      ?? footer.querySelector("div[contenteditable='true'][data-tab]")
      ?? footer.querySelector("div[contenteditable='true']");
  }

  function replaceComposerText(text) {
    const draft = String(text ?? "").trim();
    if (!draft) throw new Error("El borrador está vacío.");

    const composer = findComposer();
    if (!composer) throw new Error("No se encontró el campo para escribir el mensaje.");

    composer.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, draft);
    } catch (_error) {
      inserted = false;
    }

    if (!inserted) {
      composer.textContent = draft;
      composer.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: draft,
      }));
    }

    composer.dispatchEvent(new Event("change", { bubbles: true }));
    return composer;
  }

  function insertDraft(text) {
    replaceComposerText(text);
    return { inserted: true, sent: false };
  }

  function findSendButton() {
    const main = findMainPanel();
    const selectors = [
      "button[aria-label='Send']",
      "button[aria-label='Enviar']",
      "[data-testid='compose-btn-send']",
      "span[data-icon='send']",
    ];
    for (const selector of selectors) {
      const element = main?.querySelector(selector) ?? document.querySelector(selector);
      if (!element) continue;
      return element.closest("button, [role='button']") ?? element;
    }
    return null;
  }

  async function sendDraft(text) {
    const composer = replaceComposerText(text);
    await new Promise((resolve) => setTimeout(resolve, 140));

    const sendButton = findSendButton();
    if (sendButton) {
      sendButton.click();
      return { inserted: true, sent: true, method: "button" };
    }

    const keyOptions = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    composer.dispatchEvent(new KeyboardEvent("keydown", keyOptions));
    composer.dispatchEvent(new KeyboardEvent("keypress", keyOptions));
    composer.dispatchEvent(new KeyboardEvent("keyup", keyOptions));
    return { inserted: true, sent: true, method: "enter" };
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
        // WhatsApp may be between screens; the panel can request a fresh read later.
      }
    }, 900);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const run = async () => {
      if (message?.type === "READ_ACTIVE_CHAT") {
        return readActiveChat(message.payload?.maxMessages);
      }
      if (message?.type === "INSERT_DRAFT") {
        return insertDraft(message.payload?.text);
      }
      if (message?.type === "SEND_DRAFT") {
        return sendDraft(message.payload?.text);
      }
      return { ignored: true };
    };

    run().then(
      (result) => sendResponse(result),
      (error) => sendResponse({ error: error?.message ?? String(error) }),
    );
    return true;
  });

  STATE.observer = new MutationObserver(notifyContextChanged);
  STATE.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  notifyContextChanged();
})();
