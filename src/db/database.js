const path = require("path");
const bcrypt = require("bcrypt");

const isVercel = process.env.VERCEL === "1";
let sqlite3;
let db = null;
let useMemoryDb = isVercel;
const memory = {
  admins: [],
  contacts: [],
  courseRegistrations: [],
  courses: [],
  instructors: [],
};

try {
  if (useMemoryDb) {
    throw new Error("Use in-memory DB on Vercel");
  }
  // eslint-disable-next-line global-require
  sqlite3 = require("sqlite3").verbose();
  const dbPath = isVercel ? path.join("/tmp", "data.sqlite") : path.join(__dirname, "../../data.sqlite");
  db = new sqlite3.Database(dbPath);
} catch (error) {
  useMemoryDb = true;
  // eslint-disable-next-line no-console
  console.warn("SQLite unavailable, using in-memory DB fallback.");
}

function runAsync(sql, params = []) {
  if (useMemoryDb) {
    const query = sql.trim().toUpperCase();

    if (query.startsWith("INSERT INTO ADMINS")) {
      memory.admins.push({ id: memory.admins.length + 1, username: params[0], password_hash: params[1] });
      return Promise.resolve({ lastID: memory.admins.length });
    }
    if (query.startsWith("INSERT INTO CONTACTS")) {
      memory.contacts.unshift({
        id: memory.contacts.length + 1,
        full_name: params[0],
        phone: params[1],
        message: params[2],
        status: "new",
        created_at: new Date().toISOString(),
      });
      return Promise.resolve({ lastID: memory.contacts.length });
    }
    if (query.startsWith("INSERT INTO COURSE_REGISTRATIONS")) {
      memory.courseRegistrations.unshift({
        id: memory.courseRegistrations.length + 1,
        full_name: params[0],
        isikukood: params[1],
        phone: params[2],
        email: params[3],
        course_id: params[4],
        course_name: params[5],
        start_date: params[6],
        comment: params[7],
        status: "new",
        created_at: new Date().toISOString(),
      });
      return Promise.resolve({ lastID: memory.courseRegistrations.length });
    }
    if (query.startsWith("INSERT INTO COURSES")) {
      memory.courses.push({
        id: params[0],
        name_et: params[1],
        name_ru: params[2],
        name_en: params[3],
        description_et: params[4],
        description_ru: params[5],
        description_en: params[6],
        price: params[7],
        duration_et: params[8],
        duration_ru: params[9],
        duration_en: params[10],
        is_active: params[11] || 1,
        created_at: new Date().toISOString(),
      });
      return Promise.resolve({ lastID: memory.courses.length });
    }
    if (query.startsWith("UPDATE COURSES SET")) {
      const id = params[11];
      const row = memory.courses.find((c) => c.id === id);
      if (row) {
        row.name_et = params[0];
        row.name_ru = params[1];
        row.name_en = params[2];
        row.description_et = params[3];
        row.description_ru = params[4];
        row.description_en = params[5];
        row.price = params[6];
        row.duration_et = params[7];
        row.duration_ru = params[8];
        row.duration_en = params[9];
        row.is_active = params[10];
      }
      return Promise.resolve({ changes: row ? 1 : 0 });
    }
    if (query.startsWith("DELETE FROM COURSES")) {
      memory.courses = memory.courses.filter((c) => c.id !== params[0]);
      return Promise.resolve({ changes: 1 });
    }
    if (query.startsWith("UPDATE COURSE_REGISTRATIONS SET STATUS")) {
      const row = memory.courseRegistrations.find((s) => String(s.id) === String(params[1]));
      if (row) row.status = params[0];
      return Promise.resolve({ changes: row ? 1 : 0 });
    }
    if (query.startsWith("UPDATE CONTACTS SET STATUS")) {
      const row = memory.contacts.find((c) => String(c.id) === String(params[1]));
      if (row) row.status = params[0];
      return Promise.resolve({ changes: row ? 1 : 0 });
    }
    if (query.startsWith("DELETE FROM CONTACTS")) {
      memory.contacts = memory.contacts.filter((c) => String(c.id) !== String(params[0]));
      return Promise.resolve({ changes: 1 });
    }
    if (query.startsWith("INSERT INTO INSTRUCTORS")) {
      memory.instructors.push({
        id: params[0],
        sort_order: Number(params[1]) || 0,
        payload: params[2],
        updated_at:
          typeof params[3] === "string" && params[3] ? params[3] : new Date().toISOString(),
      });
      return Promise.resolve({ changes: 1, lastID: memory.instructors.length });
    }
    if (query.startsWith("UPDATE INSTRUCTORS SET")) {
      const id = params[params.length - 1];
      const row = memory.instructors.find((r) => String(r.id) === String(id));
      if (row) {
        row.payload = params[0];
        row.sort_order = Number(params[1]) ?? row.sort_order;
        row.updated_at = typeof params[2] === "string" ? params[2] : new Date().toISOString();
      }
      return Promise.resolve({ changes: row ? 1 : 0 });
    }
    if (query.startsWith("DELETE FROM INSTRUCTORS")) {
      const before = memory.instructors.length;
      memory.instructors = memory.instructors.filter((r) => String(r.id) !== String(params[0]));
      return Promise.resolve({ changes: before === memory.instructors.length ? 0 : 1 });
    }
    return Promise.resolve({ changes: 0 });
  }

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
  if (useMemoryDb) {
    const query = sql.trim().toUpperCase();
    if (query.includes("FROM ADMINS WHERE USERNAME")) {
      const row = memory.admins.find((a) => a.username === params[0]);
      return Promise.resolve(row || undefined);
    }
    if (query.includes("COUNT(*) AS COUNT FROM COURSES WHERE IS_ACTIVE = 1")) {
      return Promise.resolve({ count: memory.courses.filter((c) => c.is_active).length });
    }
    if (query.includes("COUNT(*) AS COUNT FROM COURSES")) {
      return Promise.resolve({ count: memory.courses.length });
    }
    if (query.includes("COUNT(*) AS COUNT FROM COURSE_REGISTRATIONS WHERE STATUS = 'NEW'")) {
      return Promise.resolve({ count: memory.courseRegistrations.filter((r) => r.status === "new").length });
    }
    if (query.includes("COUNT(*) AS COUNT FROM COURSE_REGISTRATIONS")) {
      return Promise.resolve({ count: memory.courseRegistrations.length });
    }
    if (query.includes("COUNT(*) AS COUNT FROM CONTACTS")) {
      return Promise.resolve({ count: memory.contacts.length });
    }
    if (query.includes("FROM COURSES WHERE ID")) {
      return Promise.resolve(memory.courses.find((c) => c.id === params[0]));
    }
    if (query.startsWith("SELECT COUNT(*) AS COUNT FROM INSTRUCTORS")) {
      return Promise.resolve({ count: memory.instructors.length });
    }
    if (query.startsWith("SELECT * FROM INSTRUCTORS WHERE ID = ?")) {
      return Promise.resolve(memory.instructors.find((r) => String(r.id) === String(params[0])));
    }
    if (query.startsWith("SELECT ID FROM INSTRUCTORS WHERE ID = ?")) {
      const hit = memory.instructors.find((r) => String(r.id) === String(params[0]));
      return Promise.resolve(hit ? { id: hit.id } : undefined);
    }
    return Promise.resolve(undefined);
  }

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
  if (useMemoryDb) {
    const query = sql.trim().toUpperCase();
    if (query.includes("SELECT * FROM COURSES")) {
      const list = [...memory.courses].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      if (query.includes("WHERE IS_ACTIVE = 1")) {
        return Promise.resolve(list.filter((c) => c.is_active));
      }
      return Promise.resolve(list);
    }
    if (query.includes("SELECT * FROM COURSE_REGISTRATIONS")) {
      let rows = [...memory.courseRegistrations];
      if (query.includes("STATUS = ?")) {
        rows = rows.filter((r) => r.status === params[params.length - 1]);
      }
      if (query.includes("LIKE ?")) {
        const values = params.filter((p) => String(p).startsWith("%")).map((p) => String(p).replace(/%/g, "").toLowerCase());
        rows = rows.filter((r) => {
          const hay = `${r.full_name} ${r.isikukood || ""} ${r.phone} ${r.email} ${r.course_name}`.toLowerCase();
          return values.some((v) => hay.includes(v));
        });
      }
      return Promise.resolve(rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
    }
    if (query.includes("SELECT * FROM CONTACTS")) {
      return Promise.resolve([...memory.contacts].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
    }
    if (query.startsWith("SELECT ID, SORT_ORDER, PAYLOAD FROM INSTRUCTORS")) {
      return Promise.resolve(
        [...memory.instructors].sort((a, b) =>
          a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : String(a.id).localeCompare(String(b.id))
        )
      );
    }
    return Promise.resolve([]);
  }

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
  if (useMemoryDb) {
    const adminCredentials = [
      { username: "talehh_gusseinov", password: "hab_autokool2026" },
      { username: "admin", password: "Bserg_5xg3D11" },
    ];

    for (const creds of adminCredentials) {
      const hash = await bcrypt.hash(creds.password, 10);
      const existing = memory.admins.find((a) => a.username === creds.username);
      if (existing) {
        existing.password_hash = hash;
      } else {
        memory.admins.push({
          id: memory.admins.length + 1,
          username: creds.username,
          password_hash: hash,
          created_at: new Date().toISOString(),
        });
      }
    }
    if (memory.courses.length === 0) {
      memory.courses.push(
        {
          id: "b-category",
          name_et: "B-kategooria algkursus",
          name_ru: "Базовый курс категории B",
          name_en: "Category B basic course",
          description_et: "Teooria, liiklusseadus ja praktilised soitmistunnid nullist.",
          description_ru: "Теория, ПДД и практические уроки вождения с нуля.",
          description_en: "Theory, traffic rules, and practical driving lessons from scratch.",
          price: "490 EUR",
          duration_et: "6-8 nadalad",
          duration_ru: "6-8 недель",
          duration_en: "6-8 weeks",
          is_active: 1,
          created_at: new Date().toISOString(),
        },
        {
          id: "extra-driving",
          name_et: "Lisasoit enne eksamit",
          name_ru: "Дополнительное вождение перед экзаменом",
          name_en: "Extra driving before exam",
          description_et: "Kindluse kasvatamine enne ARK soidueksamit.",
          description_ru: "Уверенность и практика перед экзаменом в ARK.",
          description_en: "Build confidence before the ARK driving exam.",
          price: "65 EUR",
          duration_et: "Paindlik graafik",
          duration_ru: "Гибкий график",
          duration_en: "Flexible schedule",
          is_active: 1,
          created_at: new Date().toISOString(),
        },
        {
          id: "driving-lessons-26",
          name_et: "Sõiduõppe tunnid",
          name_ru: "Уроки вождения",
          name_en: "Driving lessons",
          description_et: "26 praktilist sõidutundi. Järgmises sammus vali instruktor.",
          description_ru: "26 практических уроков вождения. На следующем шаге выберите инструктора.",
          description_en: "26 practical driving lessons. Choose your instructor in the next step.",
          price: "715 €",
          duration_et: "26 tundi",
          duration_ru: "26 занятий",
          duration_en: "26 lessons",
          is_active: 1,
          created_at: new Date().toISOString(),
        }
      );
    } else if (!memory.courses.some((c) => c.id === "driving-lessons-26")) {
      memory.courses.push({
        id: "driving-lessons-26",
        name_et: "Sõiduõppe tunnid",
        name_ru: "Уроки вождения",
        name_en: "Driving lessons",
        description_et: "26 praktilist sõidutundi. Järgmises sammus vali instruktor.",
        description_ru: "26 практических уроков вождения. На следующем шаге выберите инструктора.",
        description_en: "26 practical driving lessons. Choose your instructor in the next step.",
        price: "715 €",
        duration_et: "26 tundi",
        duration_ru: "26 занятий",
        duration_en: "26 lessons",
        is_active: 1,
        created_at: new Date().toISOString(),
      });
    }
    const instructorSync = require("../data/instructorSync");
    await instructorSync.refreshInstructorsFromDatabase();
    return;
  }

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

  const adminCredentials = [
    { username: "talehh_gusseinov", password: "hab_autokool2026" },
    { username: "admin", password: "Bserg_5xg3D11" },
  ];

  for (const creds of adminCredentials) {
    const existing = await getAsync("SELECT id FROM admins WHERE username = ?", [creds.username]);
    const hash = await bcrypt.hash(creds.password, 10);
    if (existing) {
      await runAsync("UPDATE admins SET password_hash = ? WHERE username = ?", [hash, creds.username]);
    } else {
      await runAsync("INSERT INTO admins (username, password_hash) VALUES (?, ?)", [creds.username, hash]);
    }
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
        "65 EUR",
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

  const drivingExists = await getAsync("SELECT id FROM courses WHERE id = ?", ["driving-lessons-26"]);
  if (!drivingExists) {
    await runAsync(
      `INSERT INTO courses
      (id, name_et, name_ru, name_en, description_et, description_ru, description_en, price, duration_et, duration_ru, duration_en, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        "driving-lessons-26",
        "Sõiduõppe tunnid",
        "Уроки вождения",
        "Driving lessons",
        "26 praktilist sõidutundi. Järgmises sammus vali instruktor.",
        "26 практических уроков вождения. На следующем шаге выберите инструктора.",
        "26 practical driving lessons. Choose your instructor in the next step.",
        "715 €",
        "26 tundi",
        "26 занятий",
        "26 lessons",
      ]
    );
  }

  await runAsync(
    "UPDATE courses SET price = ? WHERE id = ?",
    ["65 EUR", "extra-driving"]
  ).catch(() => null);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS instructors (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const instructorSync = require("../data/instructorSync");
  await instructorSync.refreshInstructorsFromDatabase();
}

module.exports = {
  db,
  runAsync,
  getAsync,
  allAsync,
  initDatabase,
};
