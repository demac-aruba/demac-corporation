(() => {
  const PATCH_FLAG = "__DEMAC_MULTILINE_EXEC_COMMAND_V042__";
  if (Document.prototype[PATCH_FLAG]) return;

  const nativeExecCommand = Document.prototype.execCommand;
  if (typeof nativeExecCommand !== "function") return;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeNewlines(value) {
    return String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function insertMultiline(documentInstance, text) {
    const normalized = normalizeNewlines(text);
    const html = escapeHtml(normalized).replace(/\n/g, "<br>");

    try {
      if (nativeExecCommand.call(documentInstance, "insertHTML", false, html)) return true;
    } catch (_error) {
    }

    const lines = normalized.split("\n");
    let insertedAnything = false;

    for (let index = 0; index < lines.length; index += 1) {
      if (index > 0) {
        let breakInserted = false;
        try {
          breakInserted = nativeExecCommand.call(documentInstance, "insertLineBreak", false, null);
        } catch (_error) {
          breakInserted = false;
        }
        if (!breakInserted) {
          try {
            breakInserted = nativeExecCommand.call(documentInstance, "insertHTML", false, "<br>");
          } catch (_error) {
            breakInserted = false;
          }
        }
        insertedAnything = insertedAnything || breakInserted;
      }

      if (lines[index]) {
        let lineInserted = false;
        try {
          lineInserted = nativeExecCommand.call(documentInstance, "insertText", false, lines[index]);
        } catch (_error) {
          lineInserted = false;
        }
        insertedAnything = insertedAnything || lineInserted;
      }
    }

    return insertedAnything;
  }

  Object.defineProperty(Document.prototype, PATCH_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  Document.prototype.execCommand = function patchedExecCommand(command, showUi, value) {
    const normalizedCommand = String(command || "").toLowerCase();
    if (normalizedCommand === "inserttext" && typeof value === "string" && /[\r\n]/.test(value)) {
      return insertMultiline(this, value);
    }
    return nativeExecCommand.call(this, command, showUi, value);
  };
})();
