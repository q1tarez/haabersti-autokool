const crypto = require("crypto");

const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const INSTRUCTOR_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const STUDENT_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function adminSessionMaxAgeMs(role) {
  return role === "instructor" ? INSTRUCTOR_COOKIE_MAX_AGE_MS : COOKIE_MAX_AGE_MS;
}

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

function signAdminSession(adminId, username, authVersion = 0, maxAgeMs = COOKIE_MAX_AGE_MS) {
  const exp = Date.now() + maxAgeMs;
  const payload = JSON.stringify({
    id: String(adminId),
    username: String(username),
    exp,
    authVersion: Number(authVersion) || 0,
  });
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
  let session;
  try {
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      session = {
        id: String(parsed.id || ""),
        username: String(parsed.username || ""),
        exp: Number(parsed.exp),
        authVersion: Number(parsed.authVersion) || 0,
      };
    }
  } catch {
    const parts = payload.split(":");
    if (parts.length >= 3) {
      session = {
        id: parts[0],
        username: parts.slice(1, -1).join(":"),
        exp: Number(parts[parts.length - 1]),
        authVersion: 0,
      };
    }
  }
  if (!session || !session.id || !session.username || !Number.isFinite(session.exp) || Date.now() > session.exp) {
    return null;
  }
  return session;
}

function signStudentSession(studentId, authVersion = 0) {
  const exp = Date.now() + STUDENT_COOKIE_MAX_AGE_MS;
  const payload = `student:${studentId}:${Number(authVersion) || 0}:${exp}`;
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
  if (![3, 4].includes(parts.length) || parts[0] !== "student") return null;
  const id = parts[1];
  const authVersion = parts.length === 4 ? Number(parts[2]) || 0 : 0;
  const exp = Number(parts[parts.length - 1]);
  if (!id || !Number.isFinite(exp) || Date.now() > exp) return null;
  return { id, exp, authVersion };
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
  INSTRUCTOR_COOKIE_MAX_AGE_MS,
  STUDENT_COOKIE_MAX_AGE_MS,
  adminSessionMaxAgeMs,
  PENDING_2FA_MS,
};
