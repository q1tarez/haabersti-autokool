const { allAsync } = require("../db/database");

const MS_DAY = 24 * 60 * 60 * 1000;

function parseCreatedAt(val) {
  if (!val) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isOlderThan24h(createdAt) {
  const d = parseCreatedAt(createdAt);
  if (!d) return false;
  return Date.now() - d.getTime() > MS_DAY;
}

async function getStaleReminders() {
  const [students, contacts] = await Promise.all([
    allAsync(
      `SELECT id, full_name, email, phone, course_name, status, created_at
       FROM course_registrations
       WHERE LOWER(COALESCE(status, 'new')) = 'new'
       ORDER BY created_at ASC`
    ),
    allAsync(
      `SELECT id, full_name AS name, email, phone, status, created_at
       FROM contacts
       WHERE LOWER(COALESCE(status, 'new')) = 'new'
       ORDER BY created_at ASC`
    ),
  ]);

  return {
    students: (students || []).filter((r) => isOlderThan24h(r.created_at)),
    contacts: (contacts || []).filter((r) => isOlderThan24h(r.created_at)),
  };
}

function formatRemindersTelegram({ students, contacts }) {
  const lines = ["⏰ Напоминание (>24 ч без обработки):"];
  if (students.length) {
    lines.push(`\nУченики (${students.length}):`);
    students.slice(0, 15).forEach((s) => {
      lines.push(`• #${s.id} ${s.full_name} — ${s.course_name || "курс"}`);
    });
  }
  if (contacts.length) {
    lines.push(`\nОбращения (${contacts.length}):`);
    contacts.slice(0, 15).forEach((c) => {
      lines.push(`• #${c.id} ${c.name} — ${c.email || c.phone || ""}`);
    });
  }
  if (!students.length && !contacts.length) return null;
  return lines.join("\n");
}

module.exports = { getStaleReminders, formatRemindersTelegram, isOlderThan24h };
