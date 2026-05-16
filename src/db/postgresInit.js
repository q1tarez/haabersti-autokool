const bcrypt = require("bcrypt");

/**
 * @param {{ runAsync: Function, getAsync: Function }} db
 */
async function runPostgresMigrations(db) {
  const { runAsync, getAsync } = db;

  await runAsync(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS contacts (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS course_registrations (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      isikukood TEXT,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      course_id TEXT NOT NULL,
      course_name TEXT NOT NULL,
      start_date TEXT,
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      is_active SMALLINT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS training_offers (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      variant_key TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active SMALLINT NOT NULL DEFAULT 1,
      payload TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS instructors (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      admin_id TEXT,
      admin_username TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await runAsync(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'`).catch(() => null);
  await runAsync(`ALTER TABLE course_registrations ADD COLUMN IF NOT EXISTS isikukood TEXT`).catch(() => null);
  await runAsync(
    `ALTER TABLE course_registrations ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'`
  ).catch(() => null);
  await runAsync(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'director'`).catch(() => null);
  await runAsync(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS instructor_id TEXT`).catch(() => null);
  await runAsync(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_secret TEXT`).catch(() => null);
  await runAsync(`ALTER TABLE course_registrations ADD COLUMN IF NOT EXISTS instructor_id TEXT`).catch(() => null);
  await runAsync(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email TEXT`).catch(() => null);

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
  if (!coursesCount || Number(coursesCount.count) === 0) {
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

  await runAsync("UPDATE courses SET price = ? WHERE id = ?", ["55 EUR", "extra-driving"]).catch(() => null);

  const upsertExtraCourses = [
    [
      "first-aid",
      "Esmaabi kursus",
      "Курс первой помощи",
      "First aid course",
      "Esmaabi teooria ja praktika.",
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
      "Öise sõidu kohustuslik etapp.",
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

  const trainingOfferCount = await getAsync("SELECT COUNT(*) AS count FROM training_offers");
  if (!trainingOfferCount || Number(trainingOfferCount.count) === 0) {
    const defaults = require("../data/trainingOfferDefaults");
    const nowIso = new Date().toISOString();
    for (const row of defaults) {
      await runAsync(
        `INSERT INTO training_offers (id, course_id, variant_key, sort_order, is_active, payload, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [row.id, row.course_id, row.variant_key ?? null, row.sort_order, JSON.stringify(row.payload), nowIso]
      );
    }
  }
}

module.exports = { runPostgresMigrations };
