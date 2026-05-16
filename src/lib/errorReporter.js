async function reportError(err, req) {
  const webhook = String(process.env.ERROR_WEBHOOK_URL || "").trim();
  const payload = {
    message: err?.message || String(err),
    stack: err?.stack,
    url: req?.originalUrl,
    method: req?.method,
    time: new Date().toISOString(),
  };
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    /* ignore */
  }
}

module.exports = { reportError };
