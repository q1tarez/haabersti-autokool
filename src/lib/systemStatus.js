const { getAsync } = require("../db/database");
const { hasSmtpConfig } = require("../mail/transport");
const { isMontonioConfigured } = require("./montonio");

async function checkDatabase() {
  const started = Date.now();
  try {
    await getAsync("SELECT 1 AS ok");
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err.message };
  }
}

function flagEnv(name) {
  return Boolean(String(process.env[name] || "").trim());
}

async function getSystemStatus() {
  const db = await checkDatabase();
  return {
    checkedAt: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    nodeEnv: process.env.NODE_ENV || "development",
    db,
    smtp: { ok: hasSmtpConfig(), label: hasSmtpConfig() ? "configured" : "missing" },
    sessionSecret: { ok: flagEnv("SESSION_SECRET") && process.env.SESSION_SECRET !== "dev-insecure-change-me" },
    publicSiteUrl: { ok: flagEnv("PUBLIC_SITE_URL") },
    telegram: { ok: flagEnv("TELEGRAM_BOT_TOKEN") && flagEnv("TELEGRAM_CHAT_ID") },
    montonio: { ok: isMontonioConfigured(), sandbox: flagEnv("MONTONIO_SANDBOX") },
    cron: { ok: flagEnv("CRON_SECRET") },
    blob: { ok: flagEnv("BLOB_READ_WRITE_TOKEN") },
    ga: { ok: flagEnv("GA_MEASUREMENT_ID") },
    bank: { ok: flagEnv("BANK_IBAN") && flagEnv("BANK_BENEFICIARY_NAME") },
  };
}

module.exports = { getSystemStatus, checkDatabase };
