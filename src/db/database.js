const path = require("path");
const bcrypt = require("bcrypt");
const { runPostgresMigrations } = require("./postgresInit");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const isVercel = process.env.VERCEL === "1";
/** Neon / Vercel Postgres: pooled URL (см. также POSTGRES_URL из интеграции Storage). */
const neonConnectionString = String(
  process.env.DATABASE_URL ||
    process.env.STORAGE_URL ||
    process.env.POSTGRES_URL ||
    ""
).trim();
const useNeon = Boolean(neonConnectionString);

let sqlite3;
let db = null;
/** @type {import("@neondatabase/serverless").Pool | null} */
let neonPool = null;
let useMemoryDb = isVercel && !useNeon;
const memory = {
  admins: [],
  contacts: [],
  courseRegistrations: [],
  courses: [],
  instructors: [],
  trainingOffers: [],
};

try {
  if (useNeon) {
    const { Pool } = require("@neondatabase/serverless");
    neonPool = new Pool({ connectionString: neonConnectionString, max: 10 });
  } else if (useMemoryDb) {
    throw new Error("Use in-memory DB on Vercel without DATABASE_URL or STORAGE_URL");
  } else {
    // eslint-disable-next-line global-require
    sqlite3 = require("sqlite3").verbose();
    const dbPath = path.join(__dirname, "../../data.sqlite");
    db = new sqlite3.Database(dbPath);
  }
} catch (error) {
  if (useNeon) {
    // eslint-disable-next-line no-console
    console.error("Neon init failed:", error.message);
    throw error;
  }
  useMemoryDb = true;
  // eslint-disable-next-line no-console
  console.warn("SQLite unavailable, using in-memory DB fallback.");
}

function sqlToNeon(sql) {
  let n = 0;
  const numbered = sql.replace(/\?/g, () => `$${++n}`);
  return numbered.replace(/\bLIKE\b/gi, "ILIKE");
}

function normalizePgRow(row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  if (Object.prototype.hasOwnProperty.call(out, "count") && out.count != null) {
    out.count = Number(out.count);
  }
  if (Object.prototype.hasOwnProperty.call(out, "is_active") && out.is_active != null) {
    out.is_active = Number(out.is_active);
  }
  if (Object.prototype.hasOwnProperty.call(out, "sort_order") && out.sort_order != null) {
    out.sort_order = Number(out.sort_order);
  }
  return out;
}

async function neonRun(sql, params = []) {
  const result = await neonPool.query(sqlToNeon(sql), params);
  const insertedId = result.rows?.[0]?.id;
  return {
    lastID: insertedId != null ? Number(insertedId) : 0,
    changes: result.rowCount || 0,
  };
}

async function neonGet(sql, params = []) {
  const result = await neonPool.query(sqlToNeon(sql), params);
  return normalizePgRow(result.rows[0]);
}

async function neonAll(sql, params = []) {
  const result = await neonPool.query(sqlToNeon(sql), params);
  return result.rows.map((r) => normalizePgRow(r));
}

function runAsync(sql, params = []) {
  if (neonPool) {
    return neonRun(sql, params);
  }
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
        payment_status: "unpaid",
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
    if (query.startsWith("UPDATE COURSE_REGISTRATIONS SET PAYMENT_STATUS = ?")) {
      const row = memory.courseRegistrations.find((s) => String(s.id) === String(params[1]));
      if (row) row.payment_status = params[0];
      return Promise.resolve({ changes: row ? 1 : 0 });
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
    if (query.startsWith("DELETE FROM COURSE_REGISTRATIONS")) {
      const before = memory.courseRegistrations.length;
      memory.courseRegistrations = memory.courseRegistrations.filter(
        (r) => String(r.id) !== String(params[0])
      );
      return Promise.resolve({ changes: before === memory.courseRegistrations.length ? 0 : 1 });
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
    if (query.startsWith("INSERT INTO TRAINING_OFFERS")) {
      memory.trainingOffers.push({
        id: params[0],
        course_id: params[1],
        variant_key: params[2],
        sort_order: Number(params[3]) || 0,
        is_active: Number(params[4]) ? 1 : 0,
        payload: params[5],
        updated_at:
          typeof params[6] === "string" && params[6] ? params[6] : new Date().toISOString(),
      });
      return Promise.resolve({ changes: 1 });
    }
    if (query.startsWith("UPDATE TRAINING_OFFERS SET")) {
      const id = params[params.length - 1];
      const row = memory.trainingOffers.find((r) => String(r.id) === String(id));
      if (row) {
        row.payload = params[0];
        row.sort_order = Number(params[1]) || 0;
        row.variant_key = params[2];
        row.course_id = params[3];
        row.is_active = Number(params[4]) ? 1 : 0;
        row.updated_at = typeof params[5] === "string" ? params[5] : new Date().toISOString();
      }
      return Promise.resolve({ changes: row ? 1 : 0 });
    }
    if (query.startsWith("DELETE FROM TRAINING_OFFERS")) {
      const before = memory.trainingOffers.length;
      memory.trainingOffers = memory.trainingOffers.filter((r) => String(r.id) !== String(params[0]));
      return Promise.resolve({ changes: before === memory.trainingOffers.length ? 0 : 1 });
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
  if (neonPool) {
    return neonGet(sql, params);
  }
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
    if (query.startsWith("SELECT * FROM TRAINING_OFFERS WHERE ID = ?")) {
      return Promise.resolve(memory.trainingOffers.find((r) => String(r.id) === String(params[0])));
    }
    if (query.startsWith("SELECT ID FROM TRAINING_OFFERS WHERE ID = ?")) {
      const hit = memory.trainingOffers.find((r) => String(r.id) === String(params[0]));
      return Promise.resolve(hit ? { id: hit.id } : undefined);
    }
    if (query.startsWith("SELECT COUNT(*) AS COUNT FROM TRAINING_OFFERS")) {
      return Promise.resolve({ count: memory.trainingOffers.length });
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
  if (neonPool) {
    return neonAll(sql, params);
  }
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
    if (query.includes("FROM TRAINING_OFFERS")) {
      let rows = [...memory.trainingOffers];
      if (query.includes("WHERE IS_ACTIVE = 1")) {
        rows = rows.filter((r) => r.is_active);
      }
      rows.sort((a, b) => {
        if (a.course_id !== b.course_id) return String(a.course_id).localeCompare(String(b.course_id));
        if (a.sort_order !== b.sort_order) return (a.sort_order || 0) - (b.sort_order || 0);
        return String(a.id).localeCompare(String(b.id));
      });
      return Promise.resolve(rows);
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

async function initNeonDatabase() {
  await runPostgresMigrations({ runAsync, getAsync });
  const instructorSync = require("../data/instructorSync");
  await instructorSync.refreshInstructorsFromDatabase();
}

async function initDatabase() {
  if (neonPool) {
    const maxAttempts = Math.max(1, Math.min(12, Number(process.env.DB_INIT_ATTEMPTS || 6)));
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await initNeonDatabase();
        return;
      } catch (err) {
        lastError = err;
        const msg = err && err.message ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[db] Neon init attempt ${attempt}/${maxAttempts} failed: ${msg}`);
        if (attempt < maxAttempts) {
          await sleep(Math.min(400 * 2 ** (attempt - 1), 8000));
        }
      }
    }
    throw lastError;
  }

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
          description_et: "Teooria, liiklusreeglid ja praktilised sõidutunnid algajatele.",
          description_ru: "Теория, ПДД и практические уроки вождения с нуля.",
          description_en: "Theory, traffic rules, and practical driving lessons from scratch.",
          price: "490 EUR",
          duration_et: "6–8 nädalat",
          duration_ru: "6-8 недель",
          duration_en: "6-8 weeks",
          is_active: 1,
          created_at: new Date().toISOString(),
        },
        {
          id: "extra-driving",
          name_et: "Lisatunnid enne eksamit",
          name_ru: "Дополнительное вождение перед экзаменом",
          name_en: "Extra driving before exam",
          description_et: "Harjuta enne sõidueksamit ja tunne end roolis kindlamalt.",
          description_ru: "Уверенность и практика перед экзаменом в ARK.",
          description_en: "Build confidence before the ARK driving exam.",
          price: "55 EUR",
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

    const extraTrainingCourses = [
      {
        id: "first-aid",
        name_et: "Esmaabikursus",
        name_ru: "Курс первой помощи",
        name_en: "First aid course",
        description_et: "Esmaabikursuse teooria ja praktika.",
        description_ru: "Теория и практика первой помощи.",
        description_en: "First aid theory and practice.",
        price: "55 EUR",
        duration_et: "Paindlik",
        duration_ru: "Гибкий график",
        duration_en: "Flexible",
      },
      {
        id: "night-driving",
        name_et: "Öine sõit",
        name_ru: "Тёмное вождение",
        name_en: "Night driving",
        description_et: "Öise sõidu kohustuslik koolitus.",
        description_ru: "Обязательный этап тёмного вождения.",
        description_en: "Mandatory night driving stage.",
        price: "70 EUR",
        duration_et: "Simulaator või individuaalselt",
        duration_ru: "Симулятор или индивидуально",
        duration_en: "Simulator or individual",
      },
      {
        id: "slippery-driving",
        name_et: "Libeda tee sõit",
        name_ru: "Скользкое вождение (RS)",
        name_en: "Slippery road (RS)",
        description_et: "RS koolitus libedal teel.",
        description_ru: "Курс RS на скользкой дороге.",
        description_en: "RS slippery road training.",
        price: "110 EUR",
        duration_et: "1 päev",
        duration_ru: "1 день",
        duration_en: "1 day",
      },
    ];
    extraTrainingCourses.forEach((c) => {
      if (!memory.courses.some((x) => x.id === c.id)) {
        memory.courses.push({ ...c, is_active: 1, created_at: new Date().toISOString() });
      }
    });

    if (memory.trainingOffers.length === 0) {
      const defaults = require("../data/trainingOfferDefaults");
      const now = new Date().toISOString();
      defaults.forEach((row) => {
        memory.trainingOffers.push({
          id: row.id,
          course_id: row.course_id,
          variant_key: row.variant_key,
          sort_order: row.sort_order,
          is_active: 1,
          payload: JSON.stringify(row.payload),
          updated_at: now,
        });
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
      payment_status TEXT DEFAULT 'unpaid',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id TEXT,
      admin_username TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
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

  await runAsync(`
    ALTER TABLE course_registrations ADD COLUMN payment_status TEXT DEFAULT 'unpaid'
  `).catch(() => null);

  await runAsync(`ALTER TABLE admins ADD COLUMN role TEXT DEFAULT 'director'`).catch(() => null);
  await runAsync(`UPDATE admins SET role = 'director' WHERE role IS NULL OR role = ''`).catch(() => null);
  await runAsync(`ALTER TABLE admins ADD COLUMN instructor_id TEXT`).catch(() => null);
  await runAsync(`ALTER TABLE admins ADD COLUMN totp_secret TEXT`).catch(() => null);
  await runAsync(`ALTER TABLE course_registrations ADD COLUMN instructor_id TEXT`).catch(() => null);
  await runAsync(`ALTER TABLE contacts ADD COLUMN email TEXT`).catch(() => null);
  await runAsync(`ALTER TABLE course_registrations ADD COLUMN internal_note TEXT`).catch(() => null);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS testimonials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      text_et TEXT NOT NULL,
      text_ru TEXT,
      text_en TEXT,
      rating INTEGER NOT NULL DEFAULT 5,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS lead_inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      source TEXT DEFAULT 'consultation',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

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
        "Teooria, liiklusreeglid ja praktilised sõidutunnid algajatele.",
        "Теория, ПДД и практические уроки вождения с нуля.",
        "Theory, traffic rules, and practical driving lessons from scratch.",
        "490 EUR",
        "6–8 nädalat",
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
        "Lisatunnid enne eksamit",
        "Дополнительное вождение перед экзаменом",
        "Extra driving before exam",
        "Harjuta enne sõidueksamit ja tunne end roolis kindlamalt.",
        "Уверенность и практика перед экзаменом в ARK.",
        "Build confidence before the ARK driving exam.",
        "55 EUR",
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
        "Talvise sõidu koolitus",
        "Тренинг зимнего вождения",
        "Winter driving training",
        "Harjutused libedal teel ja ohtlike olukordade lahendamine.",
        "Упражнения на скользкой дороге и разбор опасных ситуаций.",
        "Slippery-road practice and dangerous situation handling.",
        "120 EUR",
        "1 päev",
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
    ["55 EUR", "extra-driving"]
  ).catch(() => null);

  const upsertExtraCourses = [
    [
      "first-aid",
      "Esmaabikursus",
      "Курс первой помощи",
      "First aid course",
      "Esmaabikursuse teooria ja praktika.",
      "Теория и практика первой помощи.",
      "First aid theory and practice.",
      "55 EUR",
      "Paindlik",
      "Гибкий график",
      "Flexible",
    ],
    [
      "night-driving",
      "Öine sõit",
      "Тёмное вождение",
      "Night driving",
      "Öise sõidu kohustuslik koolitus.",
      "Обязательный этап тёмного вождения.",
      "Mandatory night driving stage.",
      "70 EUR",
      "Simulaator või individuaalselt",
      "Симулятор или индивидуально",
      "Simulator or individual",
    ],
    [
      "slippery-driving",
      "Libeda tee sõit",
      "Скользкое вождение (RS)",
      "Slippery road (RS)",
      "RS koolitus libedal teel.",
      "Курс RS на скользкой дороге.",
      "RS slippery road training.",
      "110 EUR",
      "1 päev",
      "1 день",
      "1 day",
    ],
  ];
  for (const row of upsertExtraCourses) {
    const ex = await getAsync("SELECT id FROM courses WHERE id = ?", [row[0]]);
    if (!ex) {
      await runAsync(
        `INSERT INTO courses
        (id, name_et, name_ru, name_en, description_et, description_ru, description_en, price, duration_et, duration_ru, duration_en, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        row
      );
    }
  }

  await runAsync(`
    CREATE TABLE IF NOT EXISTS training_offers (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      variant_key TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      payload TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const trainingOfferCount = await getAsync("SELECT COUNT(*) AS count FROM training_offers");
  if (!trainingOfferCount || trainingOfferCount.count === 0) {
    const defaults = require("../data/trainingOfferDefaults");
    const nowIso = new Date().toISOString();
    for (const row of defaults) {
      await runAsync(
        `INSERT INTO training_offers (id, course_id, variant_key, sort_order, is_active, payload, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [row.id, row.course_id, row.variant_key ?? null, row.sort_order, JSON.stringify(row.payload), nowIso]
      );
    }
  }

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
