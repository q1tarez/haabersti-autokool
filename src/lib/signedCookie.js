const crypto = require("crypto");

const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret() {
  const configuredSecret = String(process.env.SESSION_SECRET || "").trim();
  if (
    process.env.NODE_ENV === "production" &&
    (configuredSecret.length < 32 ||
      configuredSecret === "change-me-to-a-long-random-string" ||
      configuredSecret === "dev-insecure-change-me")
  ) {
    throw new Error("Set a unique SESSION_SECRET of at least 32 characters in production");
  }
  return configuredSecret || "dev-insecure-change-me";
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

function signStudentSession(studentId) {
  const exp = Date.now() + COOKIE_MAX_AGE_MS;
  const payload = `student:${studentId}:${exp}`;
  const sig = crypto.createHmac("sha256", getStudentSecret()).update(payload).digest("base64url");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sig}`;
}

function getStudentSecret() {
  return getSecret();
}

function verifyStudentSession(token) {
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
  const expected = crypto.createHmac("sha256", getStudentSecret()).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  const parts = payload.split(":");
  if (parts.length !== 3 || parts[0] !== "student") return null;
  const id = parts[1];
  const exp = Number(parts[2]);
  if (!id || !Number.isFinite(exp) || Date.now() > exp) return null;
  return { id, exp };
}

const PENDING_2FA_MS = 10 * 60 * 1000;

function signPending2fa(adminId) {
  const exp = Date.now() + PENDING_2FA_MS;
  const payload = `2fa:${adminId}:${exp}`;
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sig}`;
}

function verifyPending2fa(token) {
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
  if (!payload.startsWith("2fa:")) return null;
  const parts = payload.split(":");
  if (parts.length !== 3) return null;
  const adminId = parts[1];
  const exp = Number(parts[2]);
  if (!adminId || !Number.isFinite(exp) || Date.now() > exp) return null;
  return { id: adminId, exp };
}

module.exports = {
  signAdminSession,
  verifyAdminSession,
  signStudentSession,
  verifyStudentSession,
  signPending2fa,
  verifyPending2fa,
  COOKIE_MAX_AGE_MS,
  PENDING_2FA_MS,
};
