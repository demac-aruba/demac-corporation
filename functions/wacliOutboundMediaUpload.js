const crypto = require("node:crypto");
const { getAuth } = require("firebase-admin/auth");
const { getStorage } = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const { onRequest } = require("firebase-functions/v2/https");

const storage = getStorage();
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const EXACT_ALLOWED_ORIGINS = new Set([
  "https://demac-aruba.com",
  "https://www.demac-aruba.com",
  "https://demac-corporation.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function safeStorageSegment(value) {
  return String(value || "file")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 180) || "file";
}

function allowedOrigin(origin) {
  if (!origin) return true;
  if (EXACT_ALLOWED_ORIGINS.has(origin)) return true;
  return /^https:\/\/demac-corporation(?:-[a-z0-9-]+)?-demac-corporation\.vercel\.app$/i.test(origin);
}

function applyCors(request, response) {
  const origin = String(request.get("origin") || "");
  const allowed = allowedOrigin(origin);
  if (origin && allowed) {
    response.set("Access-Control-Allow-Origin", origin);
    response.set("Vary", "Origin");
  }
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.set("Access-Control-Max-Age", "3600");
  return allowed;
}

async function authenticatedErpUser(request) {
  const header = String(request.get("authorization") || "");
  if (!header.startsWith("Bearer ")) return null;
  const idToken = header.slice(7).trim();
  if (!idToken) return null;
  try {
    return await getAuth().verifyIdToken(idToken, true);
  } catch {
    return null;
  }
}

function requestRawBody(request) {
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
  if (Buffer.isBuffer(request.body)) return request.body;
  return Buffer.alloc(0);
}

exports.wacliOutboundMediaUpload = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (request, response) => {
    const corsAllowed = applyCors(request, response);
    if (request.method === "OPTIONS") {
      response.status(corsAllowed ? 204 : 403).send("");
      return;
    }
    if (!corsAllowed) {
      response.status(403).json({ error: "Origin not allowed" });
      return;
    }
    if (request.method !== "POST") {
      response.set("Allow", "POST, OPTIONS");
      response.status(405).json({ error: "Method not allowed" });
      return;
    }

    const user = await authenticatedErpUser(request);
    if (!user) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const fileName = String(request.query.fileName || "attachment").trim();
      if (!fileName || fileName.length > 240) {
        response.status(400).json({ error: "Invalid file name" });
        return;
      }
      const bytes = requestRawBody(request);
      if (!bytes.length) {
        response.status(400).json({ error: "Media body is empty" });
        return;
      }
      if (bytes.length > MAX_MEDIA_BYTES) {
        response.status(413).json({ error: "Attachment exceeds the 25 MB WhatsApp connector limit" });
        return;
      }

      const contentType = String(request.get("content-type") || "application/octet-stream").split(";")[0].trim() || "application/octet-stream";
      if (contentType === "text/html" || contentType === "image/svg+xml") {
        response.status(415).json({ error: "This file type is not allowed for WhatsApp attachments" });
        return;
      }

      const bucket = storage.bucket();
      const objectId = `${Date.now()}-${crypto.randomUUID()}`;
      const storagePath = `communication-media/outbound/${safeStorageSegment(user.uid)}/${objectId}-${safeStorageSegment(fileName)}`;
      const downloadToken = crypto.randomUUID();
      await bucket.file(storagePath).save(bytes, {
        resumable: false,
        metadata: {
          contentType,
          cacheControl: "private, max-age=3600",
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
            uploadedByUid: user.uid,
          },
        },
      });

      const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(downloadToken)}`;
      response.status(200).json({
        ok: true,
        url,
        fileName,
        mimeType: contentType,
        size: bytes.length,
      });
    } catch (error) {
      logger.error("Could not upload outbound WhatsApp media.", error);
      response.status(500).json({ error: "Could not upload WhatsApp attachment" });
    }
  },
);
