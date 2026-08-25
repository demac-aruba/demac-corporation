const crypto = require("node:crypto");

function cleanText(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function hashId(value, length = 32) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, length);
}

module.exports = {
  cleanText,
  hashId,
};
