(() => {
  const PATCH_FLAG = "__DEMAC_MULTILINE_EXEC_COMMAND_V045__";
  if (Document.prototype[PATCH_FLAG]) return;

  const nativeExecCommand = Document.prototype.execCommand;
  if (typeof nativeExecCommand !== "function") return;

  function normalizeNewlines(value) {
    return String(value)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function multilineHtml(value) {
    const lines = normalizeNewlines(value).split("\n");
    return lines.map((line) => `<div>${line ? escapeHtml(line) : "<br>"}</div>`).join("");
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
      try {
        const inserted = nativeExecCommand.call(
          this,
          "insertHTML",
          showUi,
          multilineHtml(value),
        );
        if (inserted) return true;
      } catch (_error) {
        // Fall back to the browser's native plain-text insertion below.
      }
    }

    return nativeExecCommand.call(this, command, showUi, value);
  };
})();
