/**
 * Admin authentication middleware.
 * Uses ONLY signed cookies to prevent cookie forgery attacks.
 * The cookie is signed with SESSION_SECRET via cookieParser(appSecret).
 */
function requireAdmin(req, res, next) {
  // SECURITY: Only use signedCookies — never fall back to unsigned req.cookies
  // Falling back to req.cookies would allow an attacker to forge the cookie value.
  const cookieValue = req.signedCookies && req.signedCookies.admin_auth;

  if (!cookieValue) {
    res.redirect("/admin/login");
    return;
  }

  const parts = String(cookieValue).split(":");
  const adminId = parts[0];
  const adminUsername = parts[1];

  if (!adminId || !adminUsername) {
    res.clearCookie("admin_auth", { path: "/", signed: true });
    res.redirect("/admin/login");
    return;
  }

  req.admin = { id: adminId, username: adminUsername };
  next();
}

module.exports = {
  requireAdmin,
};
