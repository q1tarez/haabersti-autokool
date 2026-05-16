const crypto = require("crypto");

const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret() {
  return String(process.env.SESSION_SECRET || "dev-insecure-change-me").trim();
}

function signAdminSession(adminId, username) {
  const exp = Date.now() + COOKIE_MAX_AGE_MS;
  const payload = `${adminId}:${username}:${exp}`;
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sig}`;
}

function verifyAdminSession(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  const parts = payload.split(":");
  if (parts.length < 3) return null;
  const exp = Number(parts[parts.length - 1]);
  const adminId = parts[0];
  const username = parts.slice(1, -1).join(":");
  if (!adminId || !username || !Number.isFinite(exp) || Date.now() > exp) {
    return null;
  }
  return { id: adminId, username, exp };
}

module.exports = { signAdminSession, verifyAdminSession, COOKIE_MAX_AGE_MS };
