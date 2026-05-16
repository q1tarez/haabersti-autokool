const express = require("express");
const { getAsync } = require("../db/database");
const { getStaleReminders, formatRemindersTelegram } = require("../lib/reminders");

const router = express.Router();

router.get("/health", async (_req, res) => {
  const started = Date.now();
  let dbOk = false;
  try {
    await getAsync("SELECT 1 AS ok");
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const ok = dbOk;
  res.status(ok ? 200 : 503).json({
    ok,
    db: dbOk,
    uptimeSec: Math.floor(process.uptime()),
    responseMs: Date.now() - started,
    env: process.env.NODE_ENV || "development",
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

module.exports = router;
