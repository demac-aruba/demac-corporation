const fs = require("node:fs");
const path = require("node:path");

const target = path.join(__dirname, "whatsappWacliGateway.js");
const publicKeyDerBase64 = "MCowBQYDK2VwAyEAe01shOc9JLdWeX8OwYyzA3Mw9ckn5fg1llLtu4QtJX0=";

let source = fs.readFileSync(target, "utf8");
const startMarker = "function verifyWacliSignature(request) {";
const endMarker = "\nfunction inferQueue(text) {";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

if (start < 0 || end < 0) {
  throw new Error("Could not locate verifyWacliSignature() in whatsappWacliGateway.js");
}

const replacement = `function verifyWacliSignature(request) {
  const provided = String(request.get("x-demac-bridge-signature") || "").trim();
  if (!provided.startsWith("ed25519=")) return false;

  const rawBody = request.rawBody instanceof Buffer
    ? request.rawBody
    : Buffer.from(JSON.stringify(request.body ?? {}));

  try {
    const signature = Buffer.from(provided.slice("ed25519=".length), "base64");
    if (signature.length !== 64) return false;
    const publicKey = crypto.createPublicKey({
      key: Buffer.from("${publicKeyDerBase64}", "base64"),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, rawBody, publicKey, signature);
  } catch {
    return false;
  }
}
`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(target, source);

const patched = fs.readFileSync(target, "utf8");
if (!patched.includes('request.get("x-demac-bridge-signature")')) {
  throw new Error("Ed25519 gateway patch verification failed.");
}
console.log("Applied DEMAC Ed25519 bridge signature verifier.");
