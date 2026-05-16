const { runAsync } = require("../db/database");

async function logAudit(req, { action, entityType = null, entityId = null, details = null }) {
  const admin = req.admin || {};
  const detailsStr =
    details === null || details === undefined
      ? null
      : typeof details === "string"
        ? details
        : JSON.stringify(details);
  try {
    await runAsync(
      `INSERT INTO audit_log (admin_id, admin_username, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [admin.id || null, admin.username || null, action, entityType, entityId, detailsStr]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[audit_log]", err.message);
  }
}

module.exports = { logAudit };
