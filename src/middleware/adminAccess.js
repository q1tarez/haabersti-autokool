const { getAsync } = require("../db/database");
const { verifyAdminSession } = require("../lib/signedCookie");
const { createAdminT, adminLangOr } = require("../i18nAdmin");
const { isDirector } = require("../lib/studentScope");

async function loadAdminRecord(session) {
  const row = await getAsync(
    "SELECT id, username, role, instructor_id, totp_secret FROM admins WHERE id = ?",
    [session.id]
  );
  if (!row) return null;
  return {
    id: String(row.id),
    username: row.username,
    role: String(row.role || "director").trim() || "director",
    instructorId: row.instructor_id ? String(row.instructor_id) : null,
    hasTotp: Boolean(String(row.totp_secret || "").trim()),
  };
}

function requireAdmin(req, res, next) {
  const cookieValue = req.cookies && req.cookies.admin_auth;
  if (!cookieValue) {
    res.redirect("/admin/login");
    return;
  }
  const session = verifyAdminSession(cookieValue);
  if (!session) {
    res.clearCookie("admin_auth", { path: "/" });
    res.redirect("/admin/login");
    return;
  }
  loadAdminRecord(session)
    .then((admin) => {
      if (!admin) {
        res.clearCookie("admin_auth", { path: "/" });
        res.redirect("/admin/login");
        return;
      }
      req.admin = admin;
      next();
    })
    .catch(next);
}

function requireDirector(req, res, next) {
  if (!isDirector(req.admin)) {
    res.status(403).send("Access denied");
    return;
  }
  next();
}

function adminI18nMiddleware(req, res, next) {
  const q = req.query.adminLang;
  if (q && adminLangOr(q)) {
    res.cookie("admin_lang", q, {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      sameSite: "lax",
      path: "/admin",
    });
  }
  const cookieLang = req.cookies && req.cookies.admin_lang;
  const adminLang = adminLangOr(cookieLang || "ru");
  res.locals.adminLang = adminLang;
  res.locals.adminT = createAdminT(adminLang);
  res.locals.isDirector = req.admin ? isDirector(req.admin) : false;
  next();
}

module.exports = { requireAdmin, requireDirector, adminI18nMiddleware, loadAdminRecord };
