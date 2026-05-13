const express = require("express");
const bcrypt = require("bcrypt");
const { getAsync, allAsync, runAsync } = require("../db/database");
const { requireAdmin } = require("../middleware/auth");
const { mergeInstructorImported } = require("../data/drivingInstructors");
const { refreshInstructorsFromDatabase } = require("../data/instructorSync");
const { formBodyToDrivingInstructor, stripIdForPayload, LOCATION_SLUGS } = require("../data/instructorAdminForm");
const { formBodyToTrainingOfferPayload, payloadToFormDefaults } = require("../data/trainingOfferForm");
const { TRAINING_OFFER_COURSE_IDS } = require("../data/trainingOffers");

const router = express.Router();

const TRAINING_COURSE_LABELS = {
  "winter-training": "Зимнее вождение",
  "first-aid": "Первая помощь",
  "night-driving": "Тёмное вождение",
  "slippery-driving": "Скользкое вождение (RS)",
};

function trainingCourseSelectOptions() {
  return TRAINING_OFFER_COURSE_IDS.map((id) => ({ id, label: `${TRAINING_COURSE_LABELS[id] || id} (${id})` }));
}

function summarizeTrainingOfferRows(rows) {
  return rows.map((row) => {
    let title = row.id;
    try {
      const p = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      title = p.titleRu || p.titleEt || title;
    } catch (_) {
      /* omit */
    }
    return { ...row, summaryTitle: title };
  });
}
const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

router.get("/", (req, res) => {
  res.redirect(303, "/admin/login");
});

router.get("/login", (req, res) => {
  res.render("admin/login", { title: req.t("adminLoginTitle"), error: null });
});

router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const admin = await getAsync("SELECT * FROM admins WHERE username = ?", [username]);

    if (!admin) {
      res.status(401).render("admin/login", { title: req.t("adminLoginTitle"), error: req.t("wrongCredentials") });
      return;
    }

    const isValid = await bcrypt.compare(password, admin.password_hash);
    if (!isValid) {
      res.status(401).render("admin/login", { title: req.t("adminLoginTitle"), error: req.t("wrongCredentials") });
      return;
    }

    res.cookie("admin_auth", `${admin.id}:${admin.username}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: oneWeekMs,
      path: "/",
    });
    res.redirect(303, "/admin/dashboard");
  } catch (error) {
    next(error);
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("admin_auth", { path: "/" });
  res.redirect(303, "/admin/login");
});

router.get("/dashboard", requireAdmin, async (req, res, next) => {
  try {
    const [coursesCount, studentsCount, contactsCount, newLeadsCount] = await Promise.all([
      getAsync("SELECT COUNT(*) AS count FROM courses WHERE is_active = 1"),
      getAsync("SELECT COUNT(*) AS count FROM course_registrations"),
      getAsync("SELECT COUNT(*) AS count FROM contacts"),
      getAsync("SELECT COUNT(*) AS count FROM course_registrations WHERE status = 'new'"),
    ]);

    res.render("admin/dashboard", {
      title: req.t("dashboardTitle"),
      username: req.admin.username,
      stats: {
        coursesCount: coursesCount.count,
        studentsCount: studentsCount.count,
        contactsCount: contactsCount.count,
        newLeadsCount: newLeadsCount.count,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/dashboard", requireAdmin, (req, res) => {
  res.redirect(303, "/admin/dashboard");
});

router.get("/courses", requireAdmin, async (req, res, next) => {
  try {
    const courses = await allAsync("SELECT * FROM courses ORDER BY created_at DESC");
    res.render("admin/courses", { title: "Админ - Курсы", courses, editingCourse: null });
  } catch (error) {
    next(error);
  }
});

router.get("/courses/:id/edit", requireAdmin, async (req, res, next) => {
  try {
    const courses = await allAsync("SELECT * FROM courses ORDER BY created_at DESC");
    const editingCourse = await getAsync("SELECT * FROM courses WHERE id = ?", [req.params.id]);
    res.render("admin/courses", { title: "Админ - Курсы", courses, editingCourse });
  } catch (error) {
    next(error);
  }
});

router.post("/courses", requireAdmin, async (req, res, next) => {
  try {
    const {
      id,
      name_et,
      name_ru,
      name_en,
      description_et,
      description_ru,
      description_en,
      price,
      duration_et,
      duration_ru,
      duration_en,
      is_active,
    } = req.body;

    const courseId = id || slugify(name_en || name_et || name_ru);
    await runAsync(
      `INSERT INTO courses
      (id, name_et, name_ru, name_en, description_et, description_ru, description_en, price, duration_et, duration_ru, duration_en, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        courseId,
        name_et,
        name_ru,
        name_en,
        description_et || "",
        description_ru || "",
        description_en || "",
        price,
        duration_et || "",
        duration_ru || "",
        duration_en || "",
        is_active ? 1 : 0,
      ]
    );
    res.redirect(303, "/admin/courses");
  } catch (error) {
    next(error);
  }
});

router.post("/courses/:id/update", requireAdmin, async (req, res, next) => {
  try {
    const {
      name_et,
      name_ru,
      name_en,
      description_et,
      description_ru,
      description_en,
      price,
      duration_et,
      duration_ru,
      duration_en,
      is_active,
    } = req.body;

    await runAsync(
      `UPDATE courses SET
        name_et = ?, name_ru = ?, name_en = ?,
        description_et = ?, description_ru = ?, description_en = ?,
        price = ?, duration_et = ?, duration_ru = ?, duration_en = ?, is_active = ?
      WHERE id = ?`,
      [
        name_et,
        name_ru,
        name_en,
        description_et || "",
        description_ru || "",
        description_en || "",
        price,
        duration_et || "",
        duration_ru || "",
        duration_en || "",
        is_active ? 1 : 0,
        req.params.id,
      ]
    );
    res.redirect(303, "/admin/courses");
  } catch (error) {
    next(error);
  }
});

router.post("/courses/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    await runAsync("DELETE FROM courses WHERE id = ?", [req.params.id]);
    res.redirect(303, "/admin/courses");
  } catch (error) {
    next(error);
  }
});

router.get("/students", requireAdmin, async (req, res, next) => {
  try {
    const search = req.query.search || "";
    const status = req.query.status || "";
    const params = [];
    let where = "WHERE 1=1";

    if (search) {
      where += " AND (full_name LIKE ? OR isikukood LIKE ? OR phone LIKE ? OR email LIKE ? OR course_name LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      where += " AND status = ?";
      params.push(status);
    }

    const students = await allAsync(
      `SELECT * FROM course_registrations ${where} ORDER BY created_at DESC`,
      params
    );
    res.render("admin/students", { title: "Админ - Ученики", students, search, status });
  } catch (error) {
    next(error);
  }
});

router.post("/students/:id/status", requireAdmin, async (req, res, next) => {
  try {
    const allowedStatus = ["new", "contacted", "closed"];
    const st = allowedStatus.includes(String(req.body.status || "")) ? req.body.status : "new";
    await runAsync("UPDATE course_registrations SET status = ? WHERE id = ?", [st, req.params.id]);
    res.redirect(303, "/admin/students");
  } catch (error) {
    next(error);
  }
});

router.post("/students/:id/payment", requireAdmin, async (req, res, next) => {
  try {
    const allowedPay = ["unpaid", "paid"];
    const pay = allowedPay.includes(String(req.body.payment_status || "")) ? req.body.payment_status : "unpaid";
    await runAsync("UPDATE course_registrations SET payment_status = ? WHERE id = ?", [pay, req.params.id]);
    res.redirect(303, "/admin/students");
  } catch (error) {
    next(error);
  }
});

router.get("/contacts", requireAdmin, async (req, res, next) => {
  try {
    const contacts = await allAsync("SELECT * FROM contacts ORDER BY created_at DESC");
    res.render("admin/contacts", { title: "Админ - Обращения", contacts });
  } catch (error) {
    next(error);
  }
});

router.post("/contacts/:id/status", requireAdmin, async (req, res, next) => {
  try {
    await runAsync("UPDATE contacts SET status = ? WHERE id = ?", [req.body.status, req.params.id]);
    res.redirect(303, "/admin/contacts");
  } catch (error) {
    next(error);
  }
});

router.post("/contacts/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    await runAsync("DELETE FROM contacts WHERE id = ?", [req.params.id]);
    res.redirect(303, "/admin/contacts");
  } catch (error) {
    next(error);
  }
});

function summarizeInstructorsRows(rows) {
  return rows.map((row) => {
    let name = row.id;
    try {
      const p = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      if (p && typeof p === "object" && p.name) name = p.name;
    } catch (_) {
      /* omit */
    }
    return {
      id: row.id,
      sort_order: row.sort_order,
      name,
    };
  });
}

router.get("/instructors", requireAdmin, async (req, res, next) => {
  try {
    const rows = await allAsync("SELECT id, sort_order, payload FROM instructors ORDER BY sort_order ASC, id ASC");
    let notice = null;
    if (req.query.created) notice = "Инструктор добавлен.";
    if (req.query.updated) notice = "Изменения сохранены.";
    if (req.query.deleted) notice = "Инструктор удалён.";
    if (req.query.err === "name") notice = "Укажите имя.";
    if (req.query.err === "id") notice = "Код может содержать только латиницу, цифры и дефис.";
    if (req.query.err === "dup") notice = "Такой ID уже есть — выберите другой код.";
    res.render("admin/instructors", {
      title: "Админ — Инструкторы",
      instructors: summarizeInstructorsRows(rows),
      editingInstructor: null,
      editingSortOrder: 0,
      editingId: null,
      instructorLocations: LOCATION_SLUGS,
      notice,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/instructors/:id/edit", requireAdmin, async (req, res, next) => {
  try {
    const rows = await allAsync("SELECT id, sort_order, payload FROM instructors ORDER BY sort_order ASC, id ASC");
    const row = await getAsync("SELECT * FROM instructors WHERE id = ?", [req.params.id]);
    if (!row) {
      res.redirect(303, "/admin/instructors");
      return;
    }

    let payload = {};
    try {
      payload = typeof row.payload === "string" ? JSON.parse(row.payload) : {};
    } catch (_) {
      payload = {};
    }
    const editingInstructor = mergeInstructorImported(row.id, typeof payload === "object" ? payload : {});

    let notice = null;
    if (req.query.err === "name") notice = "Укажите имя.";
    res.render("admin/instructors", {
      title: "Админ — Инструкторы",
      instructors: summarizeInstructorsRows(rows),
      editingInstructor,
      editingSortOrder: Number(row.sort_order) || 0,
      editingId: row.id,
      instructorLocations: LOCATION_SLUGS,
      notice,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/instructors", requireAdmin, async (req, res, next) => {
  try {
    const record = formBodyToDrivingInstructor(req.body);
    if (!String(record.name || "").trim()) {
      res.redirect(303, "/admin/instructors?err=name");
      return;
    }

    const idLooksOk = /^[a-z0-9-]+$/.test(record.id || "");
    if (!idLooksOk) {
      res.redirect(303, "/admin/instructors?err=id");
      return;
    }

    const dup = await getAsync("SELECT id FROM instructors WHERE id = ?", [record.id]);
    if (dup) {
      res.redirect(303, "/admin/instructors?err=dup");
      return;
    }

    const numericSort = Number(String(req.body.sort_order || "").trim());
    let sort_order = Number.isFinite(numericSort) ? numericSort : NaN;
    if (!Number.isFinite(sort_order)) {
      const sorted = await allAsync("SELECT sort_order FROM instructors");
      sort_order =
        sorted.length === 0
          ? 0
          : Math.max(
              ...sorted.map((x) => {
                const n = Number(x.sort_order);
                return Number.isFinite(n) ? n : 0;
              }),
              -1
            ) + 1;
    }

    const payloadJson = JSON.stringify(stripIdForPayload(record));

    await runAsync("INSERT INTO instructors (id, sort_order, payload, updated_at) VALUES (?, ?, ?, ?)", [
      record.id,
      sort_order,
      payloadJson,
      new Date().toISOString(),
    ]);

    await refreshInstructorsFromDatabase();
    res.redirect(303, "/admin/instructors?created=1");
  } catch (error) {
    next(error);
  }
});

router.post("/instructors/:id/update", requireAdmin, async (req, res, next) => {
  try {
    const existingRow = await getAsync("SELECT * FROM instructors WHERE id = ?", [req.params.id]);
    if (!existingRow) {
      res.redirect(303, "/admin/instructors");
      return;
    }

    const record = formBodyToDrivingInstructor(req.body, { editingId: req.params.id });

    if (!String(record.name || "").trim()) {
      res.redirect(303, `/admin/instructors/${encodeURIComponent(req.params.id)}/edit?err=name`);
      return;
    }

    const fromForm = Number(String(req.body.sort_order ?? "").trim());
    const sort_order = Number.isFinite(fromForm)
      ? fromForm
      : Number(existingRow.sort_order) || 0;

    const payloadJson = JSON.stringify(stripIdForPayload(record));

    await runAsync(
      `UPDATE instructors SET payload = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
      [payloadJson, sort_order, new Date().toISOString(), req.params.id]
    );

    await refreshInstructorsFromDatabase();
    res.redirect(303, `/admin/instructors?updated=1`);
  } catch (error) {
    next(error);
  }
});

router.post("/instructors/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    await runAsync("DELETE FROM instructors WHERE id = ?", [req.params.id]);
    await refreshInstructorsFromDatabase();
    res.redirect(303, "/admin/instructors?deleted=1");
  } catch (error) {
    next(error);
  }
});

router.get("/training-offers", requireAdmin, async (req, res, next) => {
  try {
    const rows = await allAsync("SELECT * FROM training_offers ORDER BY course_id ASC, sort_order ASC, id ASC");
    let notice = null;
    if (req.query.created) notice = "Предложение добавлено.";
    if (req.query.updated) notice = "Изменения сохранены.";
    if (req.query.deleted) notice = "Запись удалена.";
    if (req.query.err === "dup") notice = "Такой ID уже есть.";
    if (req.query.err === "course") notice = "Выберите тип курса.";
    res.render("admin/training-offers", {
      title: "Админ — Тренинги / группы",
      offers: summarizeTrainingOfferRows(rows),
      editingOffer: null,
      editingId: null,
      editingSortOrder: 0,
      editingCourseId: "",
      editingVariantKey: "",
      editingActive: true,
      trainingCourseOptions: trainingCourseSelectOptions(),
      notice,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/training-offers/:id/edit", requireAdmin, async (req, res, next) => {
  try {
    const rows = await allAsync("SELECT * FROM training_offers ORDER BY course_id ASC, sort_order ASC, id ASC");
    const row = await getAsync("SELECT * FROM training_offers WHERE id = ?", [req.params.id]);
    if (!row) {
      res.redirect(303, "/admin/training-offers");
      return;
    }
    let payload = {};
    try {
      payload = typeof row.payload === "string" ? JSON.parse(row.payload) : {};
    } catch (_) {
      payload = {};
    }
    const editingOffer = payloadToFormDefaults(payload);
    res.render("admin/training-offers", {
      title: "Админ — Тренинги / группы",
      offers: summarizeTrainingOfferRows(rows),
      editingOffer,
      editingId: row.id,
      editingSortOrder: Number(row.sort_order) || 0,
      editingCourseId: row.course_id || "",
      editingVariantKey: row.variant_key || "",
      editingActive: row.is_active !== 0,
      trainingCourseOptions: trainingCourseSelectOptions(),
      notice: null,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/training-offers", requireAdmin, async (req, res, next) => {
  try {
    const course_id = String(req.body.course_id || "").trim();
    if (!course_id || !TRAINING_OFFER_COURSE_IDS.includes(course_id)) {
      res.redirect(303, "/admin/training-offers?err=course");
      return;
    }

    const payload = formBodyToTrainingOfferPayload(req.body);
    let id = slugify(req.body.manual_id || "");
    if (!id) {
      id = slugify(`${course_id}-${req.body.variant_key || "opt"}-${Date.now().toString(36)}`);
    }

    const dup = await getAsync("SELECT id FROM training_offers WHERE id = ?", [id]);
    if (dup) {
      res.redirect(303, "/admin/training-offers?err=dup");
      return;
    }

    const variantKey = String(req.body.variant_key || "").trim() || null;
    const sort_order = Number(String(req.body.sort_order ?? "").trim());
    const sortOrderFinal = Number.isFinite(sort_order) ? sort_order : 0;
    const is_active = req.body.is_active ? 1 : 0;
    const payloadJson = JSON.stringify(payload);

    await runAsync(
      `INSERT INTO training_offers (id, course_id, variant_key, sort_order, is_active, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, course_id, variantKey, sortOrderFinal, is_active, payloadJson, new Date().toISOString()]
    );

    res.redirect(303, "/admin/training-offers?created=1");
  } catch (error) {
    next(error);
  }
});

router.post("/training-offers/:id/update", requireAdmin, async (req, res, next) => {
  try {
    const existing = await getAsync("SELECT * FROM training_offers WHERE id = ?", [req.params.id]);
    if (!existing) {
      res.redirect(303, "/admin/training-offers");
      return;
    }

    const course_id = String(req.body.course_id || "").trim();
    if (!course_id || !TRAINING_OFFER_COURSE_IDS.includes(course_id)) {
      res.redirect(303, "/admin/training-offers?err=course");
      return;
    }

    const payload = formBodyToTrainingOfferPayload(req.body);
    const variantKey = String(req.body.variant_key || "").trim() || null;
    const sort_order = Number(String(req.body.sort_order ?? "").trim());
    const sortOrderFinal = Number.isFinite(sort_order) ? sort_order : Number(existing.sort_order) || 0;
    const is_active = req.body.is_active ? 1 : 0;
    const payloadJson = JSON.stringify(payload);

    await runAsync(
      `UPDATE training_offers SET payload = ?, sort_order = ?, variant_key = ?, course_id = ?, is_active = ?, updated_at = ? WHERE id = ?`,
      [payloadJson, sortOrderFinal, variantKey, course_id, is_active, new Date().toISOString(), req.params.id]
    );

    res.redirect(303, "/admin/training-offers?updated=1");
  } catch (error) {
    next(error);
  }
});

router.post("/training-offers/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    await runAsync("DELETE FROM training_offers WHERE id = ?", [req.params.id]);
    res.redirect(303, "/admin/training-offers?deleted=1");
  } catch (error) {
    next(error);
  }
});

module.exports = router;
