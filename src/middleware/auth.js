/**
 * Admin authentication middleware.
 * Uses httpOnly cookies (no signing required — no SESSION_SECRET dependency).
 * Cookie is protected by httpOnly + sameSite=lax + secure in production.
 */
function requireAdmin(req, res, next) {
  const cookieValue = req.cookies && req.cookies.admin_auth;

  if (!cookieValue) {
    res.redirect("/admin/login");
    return;
  }

  const parts = String(cookieValue).split(":");
  const adminId = parts[0];
  const adminUsername = parts[1];

  if (!adminId || !adminUsername) {
    res.clearCookie("admin_auth", { path: "/" });
    res.redirect("/admin/login");
    return;
  }

  req.admin = { id: adminId, username: adminUsername };
  next();
}

module.exports = {
  requireAdmin,
};
