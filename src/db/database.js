const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");

const dbPath = path.join(__dirname, "../../data.sqlite");
const db = new sqlite3.Database(dbPath);

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

async function initDatabase() {
  await runAsync(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS course_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      isikukood TEXT,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      course_id TEXT NOT NULL,
      course_name TEXT NOT NULL,
      start_date TEXT,
      comment TEXT,
      status TEXT DEFAULT 'new',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      name_et TEXT NOT NULL,
      name_ru TEXT NOT NULL,
      name_en TEXT NOT NULL,
      description_et TEXT,
      description_ru TEXT,
      description_en TEXT,
      price TEXT NOT NULL,
      duration_et TEXT,
      duration_ru TEXT,
      duration_en TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runAsync(`
    ALTER TABLE contacts ADD COLUMN status TEXT DEFAULT 'new'
  `).catch(() => null);

  await runAsync(`
    ALTER TABLE course_registrations ADD COLUMN isikukood TEXT
  `).catch(() => null);

  const admin = await getAsync("SELECT id FROM admins WHERE username = ?", ["admin"]);
  if (!admin) {
    const hash = await bcrypt.hash("admin123", 10);
    await runAsync("INSERT INTO admins (username, password_hash) VALUES (?, ?)", ["admin", hash]);
  }

  const coursesCount = await getAsync("SELECT COUNT(*) AS count FROM courses");
  if (!coursesCount || coursesCount.count === 0) {
    await runAsync(
      `INSERT INTO courses
      (id, name_et, name_ru, name_en, description_et, description_ru, description_en, price, duration_et, duration_ru, duration_en, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        "b-category",
        "B-kategooria algkursus",
        "Базовый курс категории B",
        "Category B basic course",
        "Teooria, liiklusseadus ja praktilised soitmistunnid nullist.",
        "Теория, ПДД и практические уроки вождения с нуля.",
        "Theory, traffic rules, and practical driving lessons from scratch.",
        "490 EUR",
        "6-8 nadalad",
        "6-8 недель",
        "6-8 weeks",
      ]
    );

    await runAsync(
      `INSERT INTO courses
      (id, name_et, name_ru, name_en, description_et, description_ru, description_en, price, duration_et, duration_ru, duration_en, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        "extra-driving",
        "Lisasoit enne eksamit",
        "Дополнительное вождение перед экзаменом",
        "Extra driving before exam",
        "Kindluse kasvatamine enne ARK soidueksamit.",
        "Уверенность и практика перед экзаменом в ARK.",
        "Build confidence before the ARK driving exam.",
        "45 EUR / h",
        "Paindlik graafik",
        "Гибкий график",
        "Flexible schedule",
      ]
    );

    await runAsync(
      `INSERT INTO courses
      (id, name_et, name_ru, name_en, description_et, description_ru, description_en, price, duration_et, duration_ru, duration_en, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        "winter-training",
        "Talvesoidu treening",
        "Тренинг зимнего вождения",
        "Winter driving training",
        "Libeda tee harjutused ja ohtlike olukordade lahendamine.",
        "Упражнения на скользкой дороге и разбор опасных ситуаций.",
        "Slippery-road practice and dangerous situation handling.",
        "120 EUR",
        "1 paev",
        "1 день",
        "1 day",
      ]
    );
  }
}

module.exports = {
  db,
  runAsync,
  getAsync,
  allAsync,
  initDatabase,
};
