const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");
const multer = require("multer");
const { getAsync, allAsync, runAsync } = require("../db/database");
const { requireAdmin, requireDirector, adminI18nMiddleware } = require("../middleware/auth");
const {
  signAdminSession,
  verifyAdminSession,
  signPending2fa,
  verifyPending2fa,
  COOKIE_MAX_AGE_MS,
  PENDING_2FA_MS,
} = require("../lib/signedCookie");
const { verifyTotp, generateSecret, otpauthUrl } = require("../lib/totp");
const { studentScopeWhere, canAccessStudent, isDirector } = require("../lib/studentScope");
const { getStaleReminders } = require("../lib/reminders");
const { sendContactReplyMail } = require("../mail/contactReplyMail");
const { uploadImageFromDisk } = require("../lib/blobUpload");
const { logAudit } = require("../lib/auditLog");
const { sendPaymentReminderMail } = require("../mail/paymentReminderMail");
const { getSystemStatus } = require("../lib/systemStatus");
const { hasSmtpConfig } = require("../mail/transport");
const { mergeInstructorImported } = require("../data/drivingInstructors");
const { refreshInstructorsFromDatabase } = require("../data/instructorSync");
const { formBodyToDrivingInstructor, stripIdForPayload, LOCATION_SLUGS } = require("../data/instructorAdminForm");
const { formBodyToTrainingOfferPayload, payloadToFormDefaults } = require("../data/trainingOfferForm");
const { TRAINING_OFFER_COURSE_IDS } = require("../data/trainingOffers");

const router = express.Router();

router.use(adminI18nMiddleware);

router.use((req, res, next) => {
  res.locals.adminPath = req.path;
  const cookieValue = req.cookies && req.cookies.admin_auth;
  if (cookieValue) {
    const session = verifyAdminSession(cookieValue);
    if (session) res.locals.adminUsername = session.username;
  }
  next();
});

const uploadDir = path.join(__dirname, "../../public/images/uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || "file")
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .slice(0, 80);
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp|svg\+xml|svg)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only images allowed"));
  },
});

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

    if (String(admin.totp_secret || "").trim()) {
      res.cookie("admin_2fa_pending", signPending2fa(admin.id), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: PENDING_2FA_MS,
        path: "/admin",
      });
      res.redirect(303, "/admin/login/2fa");
      return;
    }

    res.cookie("admin_auth", signAdminSession(admin.id, admin.username), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: COOKIE_MAX_AGE_MS,
      path: "/",
    });
    await logAudit({ admin: { id: admin.id, username: admin.username } }, { action: "login" });
    res.redirect(303, "/admin/dashboard");
  } catch (error) {
    next(error);
  }
});

router.get("/login/2fa", (req, res) => {
  const pending = req.cookies && req.cookies.admin_2fa_pending;
  if (!pending || !verifyPending2fa(pending)) {
    res.redirect(303, "/admin/login");
    return;
  }
  res.render("admin/login-2fa", {
    title: res.locals.adminT("login2faTitle"),
    error: null,
    adminLogin: true,
  });
});

router.post("/login/2fa", async (req, res, next) => {
  try {
    const pending = req.cookies && req.cookies.admin_2fa_pending;
    const session = pending ? verifyPending2fa(pending) : null;
    if (!session) {
      res.redirect(303, "/admin/login");
      return;
    }
    const admin = await getAsync("SELECT * FROM admins WHERE id = ?", [session.id]);
    if (!admin || !String(admin.totp_secret || "").trim()) {
      res.redirect(303, "/admin/login");
      return;
    }
    if (!verifyTotp(admin.totp_secret, req.body.code)) {
      res.status(401).render("admin/login-2fa", {
        title: res.locals.adminT("login2faTitle"),
        error: req.t("wrongCredentials"),
        adminLogin: true,
      });
      return;
    }
    res.clearCookie("admin_2fa_pending", { path: "/admin" });
    res.cookie("admin_auth", signAdminSession(admin.id, admin.username), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: COOKIE_MAX_AGE_MS,
      path: "/",
    });
    await logAudit({ admin: { id: admin.id, username: admin.username } }, { action: "login_2fa" });
    res.redirect(303, "/admin/dashboard");
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (req, res) => {
  if (req.admin) await logAudit(req, { action: "logout" });
  res.clearCookie("admin_auth", { path: "/" });
  res.redirect(303, "/admin/login");
});

router.post("/upload-image", requireAdmin, requireDirector, upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ ok: false, error: "No file" });
      return;
    }
    let publicPath = `/images/uploads/${req.file.filename}`;
    const blobResult = await uploadImageFromDisk({
      filePath: req.file.path,
      filename: req.file.filename,
      contentType: req.file.mimetype,
    });
    if (blobResult && blobResult.path) {
      publicPath = blobResult.path;
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {
        /* omit */
      }
    }
    await logAudit(req, { action: "upload_image", entityType: "file", entityId: publicPath });
    res.json({ ok: true, path: publicPath });
  } catch (error) {
    next(error);
  }
});

router.get("/audit-log", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    let sql = "SELECT * FROM audit_log WHERE 1=1";
    const params = [];
    if (q) {
      sql +=
        " AND (action LIKE ? OR admin_username LIKE ? OR entity_type LIKE ? OR entity_id LIKE ? OR COALESCE(details,'') LIKE ?)";
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }
    sql += " ORDER BY created_at DESC LIMIT 200";
    const logs = await allAsync(sql, params);
    res.render("admin/audit-log", {
      title: res.locals.adminT("navAudit"),
      logs,
      search: q,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/dashboard", requireAdmin, async (req, res, next) => {
  try {
    const scope = studentScopeWhere(req.admin);
    const studentCountSql = `SELECT COUNT(*) AS count FROM course_registrations WHERE 1=1${scope.sql}`;
    const newLeadsSql = `SELECT COUNT(*) AS count FROM course_registrations WHERE status = 'new'${scope.sql}`;
    const [coursesCount, studentsCount, contactsCount, newLeadsCount, reminders] = await Promise.all([
      isDirector(req.admin)
        ? getAsync("SELECT COUNT(*) AS count FROM courses WHERE is_active = 1")
        : Promise.resolve({ count: 0 }),
      getAsync(studentCountSql, scope.params),
      isDirector(req.admin) ? getAsync("SELECT COUNT(*) AS count FROM contacts") : Promise.resolve({ count: 0 }),
      getAsync(newLeadsSql, scope.params),
      getStaleReminders(),
    ]);

    res.render("admin/dashboard", {
      title: res.locals.adminT("navDashboard"),
      username: req.admin.username,
      stats: {
        coursesCount: coursesCount.count,
        studentsCount: studentsCount.count,
        contactsCount: contactsCount.count,
        newLeadsCount: newLeadsCount.count,
      },
      reminders,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/dashboard", requireAdmin, (req, res) => {
  res.redirect(303, "/admin/dashboard");
});

router.get("/courses", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    const courses = await allAsync("SELECT * FROM courses ORDER BY created_at DESC");
    res.render("admin/courses", { title: "Админ - Курсы", courses, editingCourse: null });
  } catch (error) {
    next(error);
  }
});

router.get("/courses/:id/edit", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    const courses = await allAsync("SELECT * FROM courses ORDER BY created_at DESC");
    const editingCourse = await getAsync("SELECT * FROM courses WHERE id = ?", [req.params.id]);
    res.render("admin/courses", { title: "Админ - Курсы", courses, editingCourse });
  } catch (error) {
    next(error);
  }
});

router.post("/courses", requireAdmin, requireDirector, async (req, res, next) => {
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
    await logAudit(req, { action: "create", entityType: "course", entityId: courseId });
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

router.post("/courses/:id/update", requireAdmin, requireDirector, async (req, res, next) => {
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

    await logAudit(req, { action: "update", entityType: "course", entityId: req.params.id });
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

router.post("/courses/:id/delete", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    await runAsync("DELETE FROM courses WHERE id = ?", [req.params.id]);
    await logAudit(req, { action: "delete", entityType: "course", entityId: req.params.id });
    res.redirect(303, "/admin/courses");
  } catch (error) {
    next(error);
  }
});

router.get("/courses/:id/preview", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    const course = await getAsync("SELECT * FROM courses WHERE id = ?", [req.params.id]);
    if (!course) {
      res.status(404).send("Course not found");
      return;
    }
    const lang = ["et", "ru", "en"].includes(req.query.lang) ? req.query.lang : "ru";
    res.render("admin/course-preview", {
      course: {
        name: course[`name_${lang}`] || course.name_et,
        description: course[`description_${lang}`] || course.description_et,
        duration: course[`duration_${lang}`] || course.duration_et,
        price: course.price,
        is_active: course.is_active,
      },
      lang,
    });
  } catch (error) {
    next(error);
  }
});

function buildStudentsQuery(query, admin) {
  const search = query.search || "";
  const status = query.status || "";
  const courseId = query.courseId || "";
  const dateFrom = query.dateFrom || "";
  const dateTo = query.dateTo || "";
  const params = [];
  let where = "WHERE 1=1";
  const scope = studentScopeWhere(admin);
  where += scope.sql;
  params.push(...scope.params);

  if (search) {
    where += " AND (full_name LIKE ? OR isikukood LIKE ? OR phone LIKE ? OR email LIKE ? OR course_name LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    where += " AND status = ?";
    params.push(status);
  }
  if (courseId) {
    where += " AND course_id = ?";
    params.push(courseId);
  }
  if (dateFrom) {
    where += " AND date(created_at) >= date(?)";
    params.push(dateFrom);
  }
  if (dateTo) {
    where += " AND date(created_at) <= date(?)";
    params.push(dateTo);
  }
  return { where, params, search, status, courseId, dateFrom, dateTo };
}

async function getStudentRow(id) {
  return getAsync("SELECT * FROM course_registrations WHERE id = ?", [id]);
}

router.get("/students", requireAdmin, async (req, res, next) => {
  try {
    const q = buildStudentsQuery(req.query, req.admin);
    const students = await allAsync(
      `SELECT * FROM course_registrations ${q.where} ORDER BY created_at DESC`,
      q.params
    );
    const courseOptions = await allAsync("SELECT id, name_ru, name_et FROM courses ORDER BY name_ru");
    res.render("admin/students", {
      title: "Админ - Ученики",
      students,
      search: q.search,
      status: q.status,
      courseId: q.courseId,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      courseOptions,
      reminderFlash: req.query.reminder || "",
      smtpConfigured: hasSmtpConfig(),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/students/export.csv", requireAdmin, async (req, res, next) => {
  try {
    const q = buildStudentsQuery(req.query, req.admin);
    const students = await allAsync(
      `SELECT * FROM course_registrations ${q.where} ORDER BY created_at DESC`,
      q.params
    );
    const header = "id,created_at,full_name,isikukood,phone,email,course_id,course_name,status,payment_status,comment\n";
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = students
      .map((s) =>
        [
          s.id,
          s.created_at,
          s.full_name,
          s.isikukood,
          s.phone,
          s.email,
          s.course_id,
          s.course_name,
          s.status,
          s.payment_status,
          s.comment,
        ]
          .map(escape)
          .join(",")
      )
      .join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="students.csv"');
    res.send(`\uFEFF${header}${rows}`);
  } catch (error) {
    next(error);
  }
});

router.post("/students/:id/status", requireAdmin, async (req, res, next) => {
  try {
    const row = await getStudentRow(req.params.id);
    if (!row || !canAccessStudent(req.admin, row)) {
      res.status(404).send("Not found");
      return;
    }
    const allowedStatus = ["new", "contacted", "closed"];
    const st = allowedStatus.includes(String(req.body.status || "")) ? req.body.status : "new";
    await runAsync("UPDATE course_registrations SET status = ? WHERE id = ?", [st, req.params.id]);
    await logAudit(req, { action: "update_status", entityType: "student", entityId: req.params.id, details: { status: st } });
    res.redirect(303, "/admin/students");
  } catch (error) {
    next(error);
  }
});

router.post("/students/:id/payment", requireAdmin, async (req, res, next) => {
  try {
    const row = await getStudentRow(req.params.id);
    if (!row || !canAccessStudent(req.admin, row)) {
      res.status(404).send("Not found");
      return;
    }
    const allowedPay = ["unpaid", "paid"];
    const pay = allowedPay.includes(String(req.body.payment_status || "")) ? req.body.payment_status : "unpaid";
    await runAsync("UPDATE course_registrations SET payment_status = ? WHERE id = ?", [pay, req.params.id]);
    await logAudit(req, { action: "update_payment", entityType: "student", entityId: req.params.id, details: { payment_status: pay } });
    res.redirect(303, "/admin/students");
  } catch (error) {
    next(error);
  }
});

router.post("/students/:id/payment-reminder", requireAdmin, async (req, res, next) => {
  try {
    const row = await getStudentRow(req.params.id);
    if (!row || !canAccessStudent(req.admin, row)) {
      res.status(404).send("Not found");
      return;
    }
    if (!row.email) {
      res.redirect(303, "/admin/students?reminder=no_email");
      return;
    }
    if (!hasSmtpConfig()) {
      res.redirect(303, "/admin/students?reminder=no_smtp");
      return;
    }
    const mailLang = ["et", "ru", "en"].includes(String(req.body.mailLang || ""))
      ? String(req.body.mailLang).trim()
      : res.locals.adminLang || "ru";
    const courseRow = row.course_id
      ? await getAsync("SELECT price FROM courses WHERE id = ?", [row.course_id])
      : null;
    const amount = courseRow?.price || "";
    const result = await sendPaymentReminderMail({
      to: row.email,
      lang: mailLang,
      fullName: row.full_name,
      courseName: row.course_name,
      amount,
      registrationId: row.id,
      price: amount,
    });
    await logAudit(req, {
      action: "payment_reminder",
      entityType: "student",
      entityId: req.params.id,
      details: { email: row.email, sent: Boolean(result?.ok) },
    });
    res.redirect(303, `/admin/students?reminder=${result?.ok ? "sent" : "failed"}`);
  } catch (error) {
    next(error);
  }
});

router.get("/monitoring", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    const status = await getSystemStatus();
    let healthJson = "{}";
    try {
      const base = `${req.protocol}://${req.get("host")}`;
      const hres = await fetch(`${base}/api/health`);
      healthJson = JSON.stringify(await hres.json(), null, 2);
    } catch {
      healthJson = '{"ok":false}';
    }
    res.render("admin/monitoring", {
      title: res.locals.adminT("monitoringTitle"),
      status,
      healthJson,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/students/:id/delete", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    await runAsync("DELETE FROM course_registrations WHERE id = ?", [req.params.id]);
    await logAudit(req, { action: "delete", entityType: "student", entityId: req.params.id });
    res.redirect(303, "/admin/students");
  } catch (error) {
    next(error);
  }
});

router.get("/contacts", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    const contacts = await allAsync("SELECT * FROM contacts ORDER BY created_at DESC");
    res.render("admin/contacts", {
      title: res.locals.adminT("navContacts"),
      contacts,
      replied: req.query.replied === "1",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/contacts/:id/status", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    const allowed = ["new", "in_progress", "done"];
    const st = allowed.includes(String(req.body.status || "")) ? req.body.status : "new";
    await runAsync("UPDATE contacts SET status = ? WHERE id = ?", [st, req.params.id]);
    await logAudit(req, { action: "update_status", entityType: "contact", entityId: req.params.id, details: { status: st } });
    res.redirect(303, "/admin/contacts");
  } catch (error) {
    next(error);
  }
});

router.post("/contacts/:id/delete", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    await runAsync("DELETE FROM contacts WHERE id = ?", [req.params.id]);
    await logAudit(req, { action: "delete", entityType: "contact", entityId: req.params.id });
    res.redirect(303, "/admin/contacts");
  } catch (error) {
    next(error);
  }
});

router.get("/contacts/export.csv", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    const contacts = await allAsync("SELECT * FROM contacts ORDER BY created_at DESC");
    const header = "id,created_at,full_name,phone,email,status,message\n";
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = contacts
      .map((c) =>
        [c.id, c.created_at, c.full_name, c.phone, c.email, c.status, c.message].map(escape).join(",")
      )
      .join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="contacts.csv"');
    res.send(`\uFEFF${header}${rows}`);
  } catch (error) {
    next(error);
  }
});

const CONTACT_REPLY_TEMPLATES = {
  received: "Спасибо за обращение! Мы получили ваше сообщение и свяжемся с вами в ближайшее рабочее время.",
  call: "Мы перезвоним вам в течение рабочего дня. Если срочно — позвоните нам по телефону на сайте.",
  registered: "Для записи на курс используйте форму регистрации на сайте или ответьте на это письмо с удобным временем.",
};

router.post("/contacts/:id/reply", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    const contact = await getAsync("SELECT * FROM contacts WHERE id = ?", [req.params.id]);
    if (!contact) {
      res.status(404).send("Not found");
      return;
    }
    const to = String(req.body.email || contact.email || "").trim();
    if (!to) {
      res.redirect(303, `/admin/contacts?error=no_email&id=${req.params.id}`);
      return;
    }
    const templateKey = String(req.body.template || "").trim();
    const message =
      String(req.body.message || "").trim() ||
      CONTACT_REPLY_TEMPLATES[templateKey] ||
      CONTACT_REPLY_TEMPLATES.received;
    const subject = String(req.body.subject || "").trim() || "Haabersti Autokool — ответ на обращение";
    await sendContactReplyMail({
      to,
      recipientName: contact.full_name,
      subject,
      message,
    });
    await runAsync("UPDATE contacts SET status = ? WHERE id = ?", ["in_progress", req.params.id]);
    await logAudit(req, {
      action: "contact_reply",
      entityType: "contact",
      entityId: req.params.id,
      details: { to, template: templateKey || "custom" },
    });
    res.redirect(303, "/admin/contacts?replied=1");
  } catch (error) {
    next(error);
  }
});

router.get("/security", requireAdmin, async (req, res, next) => {
  try {
    const row = await getAsync("SELECT totp_secret FROM admins WHERE id = ?", [req.admin.id]);
    let setup = null;
    if (req.query.setup === "1" && !String(row.totp_secret || "").trim()) {
      const secret = generateSecret();
      setup = {
        secret,
        url: otpauthUrl({
          secret,
          label: req.admin.username,
          issuer: "Haabersti Autokool",
        }),
      };
    }
    res.render("admin/security", {
      title: res.locals.adminT("securityTitle"),
      enabled: Boolean(String(row.totp_secret || "").trim()),
      setup,
      error: req.query.error || null,
      success: req.query.ok || null,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/security/enable", requireAdmin, async (req, res, next) => {
  try {
    const secret = String(req.body.secret || "").trim();
    const code = String(req.body.code || "").trim();
    if (!secret || !verifyTotp(secret, code)) {
      res.redirect(303, "/admin/security?error=invalid");
      return;
    }
    await runAsync("UPDATE admins SET totp_secret = ? WHERE id = ?", [secret, req.admin.id]);
    await logAudit(req, { action: "2fa_enable" });
    res.redirect(303, "/admin/security?ok=enabled");
  } catch (error) {
    next(error);
  }
});

router.post("/security/disable", requireAdmin, async (req, res, next) => {
  try {
    const row = await getAsync("SELECT totp_secret, password_hash FROM admins WHERE id = ?", [req.admin.id]);
    const ok = await bcrypt.compare(String(req.body.password || ""), row.password_hash);
    const codeOk = verifyTotp(row.totp_secret, req.body.code);
    if (!ok || !codeOk) {
      res.redirect(303, "/admin/security?error=invalid");
      return;
    }
    await runAsync("UPDATE admins SET totp_secret = NULL WHERE id = ?", [req.admin.id]);
    await logAudit(req, { action: "2fa_disable" });
    res.redirect(303, "/admin/security?ok=disabled");
  } catch (error) {
    next(error);
  }
});

router.get("/team", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    const admins = await allAsync(
      "SELECT id, username, role, instructor_id, created_at FROM admins ORDER BY username"
    );
    const instructors = await allAsync("SELECT id FROM instructors ORDER BY id");
    res.render("admin/team", {
      title: res.locals.adminT("teamTitle"),
      admins,
      instructors: instructors.map((r) => r.id),
      saved: req.query.saved === "1",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/team/:id", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    const role = ["director", "instructor"].includes(String(req.body.role || ""))
      ? req.body.role
      : "director";
    const instructorId = role === "instructor" ? String(req.body.instructor_id || "").trim() || null : null;
    await runAsync("UPDATE admins SET role = ?, instructor_id = ? WHERE id = ?", [
      role,
      instructorId,
      req.params.id,
    ]);
    await logAudit(req, {
      action: "admin_role_update",
      entityType: "admin",
      entityId: req.params.id,
      details: { role, instructorId },
    });
    res.redirect(303, "/admin/team?saved=1");
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

router.get("/instructors", requireAdmin, requireDirector, async (req, res, next) => {
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

router.get("/instructors/:id/edit", requireAdmin, requireDirector, async (req, res, next) => {
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

router.post("/instructors", requireAdmin, requireDirector, async (req, res, next) => {
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

router.post("/instructors/:id/update", requireAdmin, requireDirector, async (req, res, next) => {
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

router.post("/instructors/:id/delete", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    await runAsync("DELETE FROM instructors WHERE id = ?", [req.params.id]);
    await refreshInstructorsFromDatabase();
    res.redirect(303, "/admin/instructors?deleted=1");
  } catch (error) {
    next(error);
  }
});

router.get("/training-offers", requireAdmin, requireDirector, async (req, res, next) => {
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

router.get("/training-offers/:id/edit", requireAdmin, requireDirector, async (req, res, next) => {
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

router.post("/training-offers", requireAdmin, requireDirector, async (req, res, next) => {
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

router.post("/training-offers/:id/update", requireAdmin, requireDirector, async (req, res, next) => {
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

router.post("/training-offers/:id/delete", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    await runAsync("DELETE FROM training_offers WHERE id = ?", [req.params.id]);
    res.redirect(303, "/admin/training-offers?deleted=1");
  } catch (error) {
    next(error);
  }
});

router.post("/students/:id/note", requireAdmin, async (req, res, next) => {
  try {
    const row = await getStudentRow(req.params.id);
    if (!row || !canAccessStudent(req.admin, row)) {
      res.status(404).send("Not found");
      return;
    }
    const note = String(req.body.internal_note || "").trim();
    await runAsync("UPDATE course_registrations SET internal_note = ? WHERE id = ?", [
      note,
      req.params.id,
    ]);
    await logAudit(req, {
      action: "student_note",
      entityType: "student",
      entityId: req.params.id,
    });
    res.redirect(303, "/admin/students");
  } catch (error) {
    next(error);
  }
});

router.get("/reviews", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    const items = await allAsync("SELECT * FROM testimonials ORDER BY sort_order ASC, id ASC");
    res.render("admin/reviews", { title: "Отзывы", items, saved: req.query.saved === "1" });
  } catch (error) {
    next(error);
  }
});

router.post("/reviews", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    const { name, text_et, text_ru, text_en, rating, sort_order } = req.body;
    await runAsync(
      `INSERT INTO testimonials (name, text_et, text_ru, text_en, rating, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        String(name || "").trim(),
        String(text_et || "").trim(),
        String(text_ru || text_et || "").trim(),
        String(text_en || text_et || "").trim(),
        Number(rating) || 5,
        Number(sort_order) || 0,
      ]
    );
    res.redirect(303, "/admin/reviews?saved=1");
  } catch (error) {
    next(error);
  }
});

router.post("/reviews/:id/toggle", requireAdmin, requireDirector, async (req, res, next) => {
  try {
    const row = await getAsync("SELECT is_active FROM testimonials WHERE id = ?", [req.params.id]);
    if (row) {
      await runAsync("UPDATE testimonials SET is_active = ? WHERE id = ?", [
        row.is_active ? 0 : 1,
        req.params.id,
      ]);
    }
    res.redirect(303, "/admin/reviews?saved=1");
  } catch (error) {
    next(error);
  }
});

module.exports = router;
