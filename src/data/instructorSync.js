const { runAsync, allAsync, getAsync } = require("../db/database");
const driving = require("./drivingInstructors");

async function seedInstructorsIfEmpty() {
  const cnt = await getAsync("SELECT COUNT(*) AS count FROM instructors");
  const n = cnt != null ? Number(cnt.count) : 0;
  if (n > 0) return;

  const rows = driving.getSeedInstructorInsertionRows();
  for (let i = 0; i < rows.length; i += 1) {
    await runAsync("INSERT INTO instructors (id, sort_order, payload) VALUES (?, ?, ?)", rows[i]);
  }
}

async function refreshInstructorsFromDatabase() {
  await seedInstructorsIfEmpty();
  const rows = await allAsync("SELECT id, sort_order, payload FROM instructors ORDER BY sort_order ASC, id ASC");
  const list = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    try {
      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      list.push(driving.mergeInstructorImported(row.id, payload));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("Skipping invalid instructor row:", row?.id, error.message);
    }
  }
  driving.replaceInstructorsList(list.length ? list : undefined);
}

module.exports = {
  seedInstructorsIfEmpty,
  refreshInstructorsFromDatabase,
};
