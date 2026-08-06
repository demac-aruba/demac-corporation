(() => {
  const PATCH_FLAG = "__DEMAC_MULTILINE_EXEC_COMMAND_V042__";
  if (Document.prototype[PATCH_FLAG]) return;

  const nativeExecCommand = Document.prototype.execCommand;
  if (typeof nativeExecCommand !== "function") return;

  function normalizeNewlines(value) {
    return String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function runCommand(documentInstance, command, value = null) {
    try {
      return Boolean(nativeExecCommand.call(documentInstance, command, false, value));
    } catch (_error) {
      return false;
    }
  }

  function insertBreak(documentInstance) {
    return runCommand(documentInstance, "insertLineBreak")
      || runCommand(documentInstance, "insertParagraph")
      || runCommand(documentInstance, "insertHTML", "<br>");
  }

  function insertMultiline(documentInstance, text) {
    const lines = normalizeNewlines(text).split("\n");
    let insertedAnything = false;

    for (let index = 0; index < lines.length; index += 1) {
      if (index > 0) insertedAnything = insertBreak(documentInstance) || insertedAnything;
      if (lines[index]) {
        insertedAnything = runCommand(documentInstance, "insertText", lines[index]) || insertedAnything;
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
