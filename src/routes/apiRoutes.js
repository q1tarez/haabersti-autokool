const express = require("express");
const { runAsync } = require("../db/database");
const { getStaleReminders, formatRemindersTelegram } = require("../lib/reminders");
const { verifyMontonioNotification } = require("../lib/montonio");
const { getSystemStatus } = require("../lib/systemStatus");

const router = express.Router();

router.get("/health", async (_req, res) => {
  const status = await getSystemStatus();
  const ok = status.db.ok;
  res.status(ok ? 200 : 503).json({
    ok,
    db: status.db.ok,
    dbMs: status.db.ms,
    uptimeSec: status.uptimeSec,
    env: status.nodeEnv,
    smtp: status.smtp.ok,
    montonio: status.montonio.ok,
  });
});

router.get("/cron/reminders", async (req, res) => {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const auth = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const queryKey = String(req.query.key || "").trim();
  if (!secret || (auth !== secret && queryKey !== secret)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  const data = await getStaleReminders();
  const text = formatRemindersTelegram(data);
  if (!text) {
    res.json({ ok: true, sent: false, students: 0, contacts: 0 });
    return;
  }
  const { sendTelegram } = require("../mail/notifySchool");
  const sent = await sendTelegram(text);
  res.json({
    ok: true,
    sent,
    students: data.students.length,
    contacts: data.contacts.length,
  });
});

router.post("/webhooks/montonio", express.json({ limit: "256kb" }), async (req, res) => {
  const token =
    String(req.body?.orderToken || req.body?.data || req.body?.token || "").trim() ||
    (typeof req.body === "string" ? req.body : "");
  const payload = verifyMontonioNotification(token);
  if (!payload) {
    res.status(400).json({ ok: false, error: "invalid_token" });
    return;
  }

  const ref = String(payload.merchantReference || "");
  const match = /^reg-(\d+)$/.exec(ref);
  const paymentStatus = String(payload.paymentStatus || payload.status || "").toUpperCase();
  const paid = paymentStatus === "PAID" || paymentStatus === "COMPLETED" || paymentStatus === "FINALIZED";

  if (match && paid) {
    await runAsync("UPDATE course_registrations SET payment_status = ? WHERE id = ?", ["paid", match[1]]);
  }

  res.json({ ok: true, received: true, paid: Boolean(match && paid) });
});

module.exports = router;
