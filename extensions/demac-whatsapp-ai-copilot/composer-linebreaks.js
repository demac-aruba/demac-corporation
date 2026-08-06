(() => {
  const PATCH_FLAG = "__DEMAC_MULTILINE_EXEC_COMMAND_V044__";
  if (Document.prototype[PATCH_FLAG]) return;

  const nativeExecCommand = Document.prototype.execCommand;
  if (typeof nativeExecCommand !== "function") return;

  function normalizeNewlines(value) {
    return String(value)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
  }

  function insertBreak(documentRef) {
    try {
      if (nativeExecCommand.call(documentRef, "insertLineBreak", false, null)) return true;
    } catch (_error) {
      // Continue with the compatible HTML fallback.
    }
    try {
      return nativeExecCommand.call(documentRef, "insertHTML", false, "<br>");
    } catch (_error) {
      return false;
    }
  }

  function insertMultiline(documentRef, showUi, value) {
    const lines = normalizeNewlines(value).split("\n");
    let inserted = nativeExecCommand.call(documentRef, "insertText", showUi, lines[0]);

    for (let index = 1; index < lines.length; index += 1) {
      const breakInserted = insertBreak(documentRef);
      if (!breakInserted) return false;
      if (lines[index]) {
        inserted = nativeExecCommand.call(documentRef, "insertText", false, lines[index]) && inserted;
      }
    }
    return inserted;
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
      return insertMultiline(this, showUi, value);
    }

    return nativeExecCommand.call(this, command, showUi, value);
  };
})();
