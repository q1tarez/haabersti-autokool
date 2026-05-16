/** SQL fragment + params to scope students list for instructor admins */
function studentScopeWhere(admin) {
  if (!admin || admin.role !== "instructor" || !admin.instructorId) {
    return { sql: "", params: [] };
  }
  return { sql: " AND instructor_id = ?", params: [String(admin.instructorId)] };
}

function canAccessStudent(admin, row) {
  if (!admin || admin.role !== "instructor" || !admin.instructorId) return true;
  return String(row.instructor_id || "") === String(admin.instructorId);
}

function isDirector(admin) {
  return !admin || admin.role !== "instructor";
}

module.exports = { studentScopeWhere, canAccessStudent, isDirector };
