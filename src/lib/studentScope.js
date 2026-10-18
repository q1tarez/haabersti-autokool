/** SQL fragment + params to scope students list for instructor admins */
function studentScopeWhere(admin) {
  if (admin?.role === "director") return { sql: "", params: [] };
  if (admin?.role === "instructor" && admin.instructorId) {
    return { sql: " AND instructor_id = ?", params: [String(admin.instructorId)] };
  }
  return { sql: " AND 1 = 0", params: [] };
}

function canAccessStudent(admin, row) {
  if (admin?.role === "director") return true;
  if (admin?.role !== "instructor" || !admin.instructorId) return false;
  return String(row?.instructor_id || "") === String(admin.instructorId);
}

function isDirector(admin) {
  return admin?.role === "director";
}

module.exports = { studentScopeWhere, canAccessStudent, isDirector };
