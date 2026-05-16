const { verifyAdminSession } = require("../lib/signedCookie");

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

  req.admin = { id: session.id, username: session.username };
  next();
}

module.exports = { requireAdmin };
