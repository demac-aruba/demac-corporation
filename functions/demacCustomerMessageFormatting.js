function cleanCustomerFacingMessage(value, maxLength = 3_000) {
  const limit = Number.isFinite(Number(maxLength)) && Number(maxLength) > 0
    ? Math.floor(Number(maxLength))
    : 3_000;
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit);
}

module.exports = {
  cleanCustomerFacingMessage,
};
