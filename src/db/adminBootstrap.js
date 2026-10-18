const bcrypt = require("bcrypt");
const crypto = require("crypto");

const previouslySeededUsernames = ["talehh_gusseinov", "admin"];

async function initializeAdmins({ getAsync, runAsync }) {
  const username = String(process.env.ADMIN_USERNAME || "").trim();
  const password = String(process.env.ADMIN_PASSWORD || "");
  const validPassword = password.length >= 12 && Buffer.byteLength(password, "utf8") <= 72;
  await runAsync("CREATE TABLE IF NOT EXISTS security_migrations (id TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)");

  // Explicit environment credentials are the supported recovery and rotation mechanism.
  if (username && validPassword) {
    const existing = await getAsync("SELECT id FROM admins WHERE username = ?", [username]);
    const hash = await bcrypt.hash(password, 12);
    if (!existing) {
      await runAsync("INSERT INTO admins (username, password_hash) VALUES (?, ?)", [username, hash]);
    } else {
      await runAsync("UPDATE admins SET password_hash = ? WHERE id = ?", [hash, existing.id]);
    }
  }

  const migration = await getAsync("SELECT id FROM security_migrations WHERE id = ?", ["remove-embedded-admin-credentials"]);
  if (!migration) {
    for (const legacyUsername of previouslySeededUsernames) {
      const row = await getAsync("SELECT id FROM admins WHERE username = ?", [legacyUsername]);
      if (!row) continue;
      const replacement = username === legacyUsername && validPassword
        ? password
        : crypto.randomBytes(32).toString("base64url");
      const hash = await bcrypt.hash(replacement, 12);
      await runAsync("UPDATE admins SET password_hash = ? WHERE id = ?", [hash, row.id]);
      if (replacement !== password) {
        console.warn(`[security] Rotated the previously seeded admin account ${legacyUsername}; set ADMIN_USERNAME and ADMIN_PASSWORD to restore access with a known password.`);
      }
    }
    await runAsync("INSERT INTO security_migrations (id) VALUES (?)", ["remove-embedded-admin-credentials"]);
  }
}

module.exports = { initializeAdmins };
