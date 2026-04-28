const express = require("express");
const bcrypt = require("bcrypt");
const { getAsync, allAsync, runAsync } = require("../db/database");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

router.get("/", (req, res) => {
  res.redirect("/admin/login");
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

    req.session.adminId = admin.id;
    req.session.adminUsername = admin.username;
    res.redirect("/admin/dashboard");
  } catch (error) {
    next(error);
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin/login");
  });
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
      username: req.session.adminUsername,
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
  res.redirect("/admin/dashboard");
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
    res.redirect("/admin/courses");
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
    res.redirect("/admin/courses");
  } catch (error) {
    next(error);
  }
});

router.post("/courses/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    await runAsync("DELETE FROM courses WHERE id = ?", [req.params.id]);
    res.redirect("/admin/courses");
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
    await runAsync("UPDATE course_registrations SET status = ? WHERE id = ?", [req.body.status, req.params.id]);
    res.redirect("/admin/students");
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
    res.redirect("/admin/contacts");
  } catch (error) {
    next(error);
  }
});

router.post("/contacts/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    await runAsync("DELETE FROM contacts WHERE id = ?", [req.params.id]);
    res.redirect("/admin/contacts");
  } catch (error) {
    next(error);
  }
});

module.exports = router;
