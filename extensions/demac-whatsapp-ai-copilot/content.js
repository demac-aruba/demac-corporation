(() => {
  const BUILD_VERSION = chrome.runtime.getManifest().version;
  const previousInstance = window.__DEMAC_WHATSAPP_COPILOT__;
  if (previousInstance?.dispose) previousInstance.dispose();
  const STATE = {
    lastFingerprint: "",
    observer: null,
    debounceTimer: null,
  };

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalizeName(value) {
    return normalizeText(value)
      .toLocaleLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
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

  function nearestDataId(element) {
    return element?.getAttribute?.("data-id")
      || element?.closest?.("[data-id]")?.getAttribute("data-id")
      || "";
  }

  function metadataElementFor(element) {
    return element?.matches?.("[data-pre-plain-text]")
      ? element
      : element?.closest?.("[data-pre-plain-text]")
        ?? element?.querySelector?.("[data-pre-plain-text]")
        ?? null;
  }

  function messageRootFor(element, main) {
    const root = element?.closest?.(
      ".message-in, .message-out, [data-testid='msg-container'], [data-id]",
    ) ?? metadataElementFor(element);
    return root && main.contains(root) ? root : null;
  }

  function candidateMessageRecords(main) {
    const records = [];
    const seen = new Set();
    const metadataNodes = [...main.querySelectorAll("[data-pre-plain-text]")]
      .filter((element) => element.matches("span.selectable-text, [data-testid='msg-text']")
        || element.querySelector("span.selectable-text, [data-testid='msg-text']"));
    const sourceNodes = metadataNodes.length
      ? metadataNodes
      : [...main.querySelectorAll("span.selectable-text, [data-testid='msg-text']")];

    for (const source of sourceNodes) {
      const metadataElement = metadataElementFor(source);
      const textElement = source.matches?.("span.selectable-text, [data-testid='msg-text']")
        ? source
        : source.querySelector("span.selectable-text, [data-testid='msg-text']");
      const root = messageRootFor(source, main) ?? messageRootFor(textElement, main) ?? source;
      if (!root || !textElement) continue;

      const dataId = nearestDataId(root) || nearestDataId(source);
      const metadata = metadataElement?.getAttribute("data-pre-plain-text") || "";
      const key = dataId || `${metadata}|${normalizeText(textElement.textContent)}|${records.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({ root, source, textElement, metadataElement, dataId, metadata });
    }

    return records.sort((a, b) => {
      if (a.root === b.root) return 0;
      const position = a.root.compareDocumentPosition(b.root);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function textFromRecord(record) {
    const scope = record.metadataElement ?? record.root;
    const pieces = [...scope.querySelectorAll("span.selectable-text, [data-testid='msg-text']")]
      .map((element) => normalizeText(element.textContent))
      .filter(Boolean);
    if (pieces.length) return [...new Set(pieces)].join("\n");
    return normalizeText(record.textElement?.textContent);
  }

  function senderFromMetadata(metadata) {
    const raw = String(metadata || "").trim();
    const closingBracket = raw.lastIndexOf("]");
    const suffix = closingBracket >= 0 ? raw.slice(closingBracket + 1).trim() : raw;
    const colon = suffix.lastIndexOf(":");
    return normalizeText(colon >= 0 ? suffix.slice(0, colon) : suffix);
  }

  function isSelfSender(sender) {
    const value = normalizeName(sender);
    return ["you", "me", "yo", "tu", "tú", "vos", "demac"].includes(value);
  }

  function hasOutboundStatus(root) {
    const selectors = [
      "span[data-icon='msg-check']",
      "span[data-icon='msg-dblcheck']",
      "span[data-icon='msg-dblcheck-ack']",
      "[aria-label*='Read']",
      "[aria-label*='Delivered']",
      "[aria-label*='Sent']",
      "[aria-label*='Leído']",
      "[aria-label*='Entregado']",
      "[aria-label*='Enviado']",
    ];
    return selectors.some((selector) => root.querySelector(selector));
  }

  function directionFromDataId(dataId) {
    const value = String(dataId || "");
    if (/^(true|1)_/i.test(value) || /_true_/i.test(value)) return "outbound";
    if (/^(false|0)_/i.test(value) || /_false_/i.test(value)) return "inbound";
    return "unknown";
  }

  function directionFromLayout(record, main) {
    let element = record.metadataElement ?? record.textElement ?? record.root;
    for (let depth = 0; element && element !== main && depth < 7; depth += 1) {
      const style = getComputedStyle(element);
      if (style.alignSelf === "flex-end" || style.justifyContent === "flex-end") return "outbound";
      if (style.alignSelf === "flex-start" || style.justifyContent === "flex-start") return "inbound";
      if (style.marginLeft === "auto" && style.marginRight !== "auto") return "outbound";
      if (style.marginRight === "auto" && style.marginLeft !== "auto") return "inbound";
      element = element.parentElement;
    }
    return "unknown";
  }

  function visualElementFor(record) {
    const candidates = [record.metadataElement, record.textElement, record.root].filter(Boolean);
    return candidates.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) ?? record.root;
  }

  function positionRatio(record, main) {
    const element = visualElementFor(record);
    const rect = element?.getBoundingClientRect?.();
    const mainRect = main.getBoundingClientRect();
    if (!rect?.width || !mainRect.width) return null;
    return (rect.left + (rect.width / 2) - mainRect.left) / mainRect.width;
  }

  function classifyDirection(record, main, chatTitle) {
    const classContainer = record.root.closest?.(".message-in, .message-out")
      ?? record.root.querySelector?.(".message-in, .message-out");
    if (classContainer?.classList.contains("message-in")) {
      return { direction: "inbound", method: "class", sender: "", ratio: positionRatio(record, main) };
    }
    if (classContainer?.classList.contains("message-out")) {
      return { direction: "outbound", method: "class", sender: "", ratio: positionRatio(record, main) };
    }

    if (hasOutboundStatus(record.root)) {
      return { direction: "outbound", method: "status-icon", sender: "", ratio: positionRatio(record, main) };
    }

    const sender = senderFromMetadata(record.metadata);
    if (sender) {
      if (isSelfSender(sender)) {
        return { direction: "outbound", method: "metadata-self", sender, ratio: positionRatio(record, main) };
      }
      const normalizedSender = normalizeName(sender);
      const normalizedTitle = normalizeName(chatTitle);
      if (normalizedSender && normalizedTitle && (
        normalizedSender === normalizedTitle
        || normalizedTitle.includes(normalizedSender)
        || normalizedSender.includes(normalizedTitle)
      )) {
        return { direction: "inbound", method: "metadata-contact", sender, ratio: positionRatio(record, main) };
      }
      return { direction: "inbound", method: "metadata-sender", sender, ratio: positionRatio(record, main) };
    }

    const byId = directionFromDataId(record.dataId);
    if (byId !== "unknown") {
      return { direction: byId, method: "data-id", sender: "", ratio: positionRatio(record, main) };
    }

    const byLayout = directionFromLayout(record, main);
    if (byLayout !== "unknown") {
      return { direction: byLayout, method: "layout", sender: "", ratio: positionRatio(record, main) };
    }

    const ratio = positionRatio(record, main);
    if (ratio !== null) {
      return {
        direction: ratio < 0.5 ? "inbound" : "outbound",
        method: "text-position",
        sender: "",
        ratio,
      };
    }

    return { direction: "unknown", method: "unresolved", sender: "", ratio: null };
  }

  function extractMessages(main, maxMessages, chatTitle) {
    const messages = [];
    const fingerprints = new Set();

    for (const record of candidateMessageRecords(main)) {
      const text = textFromRecord(record);
      if (!text) continue;
      const classification = classifyDirection(record, main, chatTitle);
      const fingerprint = `${classification.direction}:${record.dataId}:${record.metadata}:${text}`;
      if (fingerprints.has(fingerprint)) continue;
      fingerprints.add(fingerprint);
      messages.push({
        id: record.dataId,
        direction: classification.direction,
        directionMethod: classification.method,
        sender: classification.sender,
        positionRatio: classification.ratio,
        text,
      });
    }

    return messages.slice(-Math.max(1, Math.min(Number(maxMessages) || 24, 50)));
  }

  function latestCustomerTurn(messages) {
    let lastInboundIndex = [...messages]
      .map((message) => message.direction)
      .lastIndexOf("inbound");

    if (lastInboundIndex < 0) {
      lastInboundIndex = [...messages]
        .map((message) => message.positionRatio !== null && message.positionRatio < 0.5)
        .lastIndexOf(true);
    }
    if (lastInboundIndex < 0) return { text: "", count: 0, messageIds: [], inferred: false };

    const isCustomer = (message) => message.direction === "inbound"
      || (message.direction === "unknown" && message.positionRatio !== null && message.positionRatio < 0.5);
    let start = lastInboundIndex;
    while (start > 0 && isCustomer(messages[start - 1])) start -= 1;
    const turn = messages.slice(start, lastInboundIndex + 1).filter((message) => message.text);
    return {
      text: turn.map((message) => message.text).join("\n"),
      count: turn.length,
      messageIds: turn.map((message) => message.id).filter(Boolean),
      inferred: turn.some((message) => message.direction !== "inbound"),
    };
  }

  function readActiveChat(maxMessages = 24) {
    const main = findMainPanel();
    if (!main) throw new Error("Selecciona una conversación en WhatsApp Web.");

    const chatTitle = findChatTitle(main);
    const messages = extractMessages(main, maxMessages, chatTitle);
    const customerTurn = latestCustomerTurn(messages);
    const diagnostic = messages.reduce((result, message) => {
      result[message.directionMethod] = (result[message.directionMethod] || 0) + 1;
      return result;
    }, {});

    return {
      buildVersion: BUILD_VERSION,
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
    return { inserted: true, sent: false, buildVersion: BUILD_VERSION };
  }

  function findSendButton(composer) {
    const footer = composer.closest("footer") ?? document.querySelector("#main footer") ?? document.querySelector("footer");
    if (!footer) return null;

    const explicitSelectors = [
      "button[aria-label='Send']",
      "button[aria-label='Enviar']",
      "[data-testid='compose-btn-send']",
      "button span[data-icon='send']",
      "[role='button'] span[data-icon='send']",
      "span[data-icon='send']",
      "svg[aria-label='Send']",
      "svg[aria-label='Enviar']",
    ];
    for (const selector of explicitSelectors) {
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

  async function sendDraft(text) {
    const composer = replaceComposerText(text);
    await new Promise((resolve) => setTimeout(resolve, 220));
    const sendButton = findSendButton(composer);
    if (!sendButton) {
      throw new Error("No se encontró el botón verde de enviar en esta versión de WhatsApp Web.");
    }

    clickElement(sendButton);
    const cleared = await waitForComposerToClear(composer);
    if (!cleared) {
      throw new Error("WhatsApp no confirmó el envío. El texto permanece en el campo para que puedas enviarlo manualmente.");
    }
    return { inserted: true, sent: true, method: "send-button", buildVersion: BUILD_VERSION };
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
          return { buildVersion: BUILD_VERSION };
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
    readActiveChat,
    dispose() {
      clearTimeout(STATE.debounceTimer);
      STATE.observer?.disconnect();
      chrome.runtime.onMessage.removeListener(messageListener);
    },
  };

  notifyContextChanged();
})();
