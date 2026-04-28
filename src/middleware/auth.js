function requireAdmin(req, res, next) {
  const cookieValue = req.signedCookies?.admin_auth || req.cookies?.admin_auth;
  if (!cookieValue) {
    res.redirect("/admin/login");
    return;
  }

  const [adminId, adminUsername] = String(cookieValue).split(":");
  if (!adminId || !adminUsername) {
    res.clearCookie("admin_auth");
    res.redirect("/admin/login");
    return;
  }

  req.admin = { id: adminId, username: adminUsername };
  next();
}

module.exports = {
  requireAdmin,
};
