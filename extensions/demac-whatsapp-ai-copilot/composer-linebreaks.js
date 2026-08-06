(() => {
  const PATCH_FLAG = "__DEMAC_MULTILINE_EXEC_COMMAND_V043__";
  if (Document.prototype[PATCH_FLAG]) return;

  const nativeExecCommand = Document.prototype.execCommand;
  if (typeof nativeExecCommand !== "function") return;

  function preserveVisualLineBreaks(value) {
    return String(value)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n/g, "\u2028");
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
      return nativeExecCommand.call(
        this,
        command,
        showUi,
        preserveVisualLineBreaks(value),
      );
    }

    return nativeExecCommand.call(this, command, showUi, value);
  };
})();
