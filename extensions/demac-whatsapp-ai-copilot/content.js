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

  function textFromMessageNode(node) {
    const selectable = node.querySelectorAll("span.selectable-text, [data-testid='msg-text']");
    const pieces = [...selectable]
      .map((element) => normalizeText(element.textContent))
      .filter(Boolean);
    if (pieces.length) return [...new Set(pieces)].join("\n");

    const copyable = node.querySelector("[data-pre-plain-text]");
    return normalizeText(copyable?.textContent);
  }

  function directionFromNode(node) {
    if (node.matches(".message-in") || node.querySelector(".message-in")) return "inbound";
    if (node.matches(".message-out") || node.querySelector(".message-out")) return "outbound";
    const row = node.closest(".message-in, .message-out");
    if (row?.classList.contains("message-in")) return "inbound";
    if (row?.classList.contains("message-out")) return "outbound";
    return "unknown";
  }

  function extractMessages(main, maxMessages) {
    const rawNodes = [
      ...main.querySelectorAll(".message-in, .message-out"),
      ...main.querySelectorAll("[data-id]")
    ];
    const uniqueNodes = [...new Set(rawNodes)];
    const messages = [];

    for (const node of uniqueNodes) {
      const text = textFromMessageNode(node);
      if (!text) continue;
      const direction = directionFromNode(node);
      const id = node.getAttribute("data-id") || node.closest("[data-id]")?.getAttribute("data-id") || "";
      const fingerprint = `${direction}:${id}:${text}`;
      if (messages.some((message) => message.fingerprint === fingerprint)) continue;
      messages.push({ id, direction, text, fingerprint });
    }

    return messages.slice(-Math.max(1, Math.min(Number(maxMessages) || 20, 50)))
      .map(({ fingerprint, ...message }) => message);
  }

  function readActiveChat(maxMessages = 20) {
    const main = findMainPanel();
    if (!main) throw new Error("Selecciona una conversación en WhatsApp Web.");

    const chatTitle = findChatTitle(main);
    const messages = extractMessages(main, maxMessages);
    return {
      chatTitle,
      messages,
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

  function insertDraft(text) {
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
    return { inserted: true, sent: false };
  }

  function notifyContextChanged() {
    clearTimeout(STATE.debounceTimer);
    STATE.debounceTimer = setTimeout(() => {
      try {
        const context = readActiveChat(10);
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
    try {
      if (message?.type === "READ_ACTIVE_CHAT") {
        sendResponse(readActiveChat(message.payload?.maxMessages));
        return;
      }
      if (message?.type === "INSERT_DRAFT") {
        sendResponse(insertDraft(message.payload?.text));
        return;
      }
      sendResponse({ ignored: true });
    } catch (error) {
      sendResponse({ error: error?.message ?? String(error) });
    }
  });

  STATE.observer = new MutationObserver(notifyContextChanged);
  STATE.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  notifyContextChanged();
})();
