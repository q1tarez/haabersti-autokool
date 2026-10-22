const {
  signAdminSession,
  verifyAdminSession,
  signStudentSession,
  verifyStudentSession,
  STUDENT_COOKIE_MAX_AGE_MS,
  INSTRUCTOR_COOKIE_MAX_AGE_MS,
  adminSessionMaxAgeMs,
} = require("../src/lib/signedCookie");

describe("signedCookie", () => {
  const prev = process.env.SESSION_SECRET;
  beforeAll(() => {
    process.env.SESSION_SECRET = "test-secret-key-for-jest";
  });
  afterAll(() => {
    process.env.SESSION_SECRET = prev;
  });

  test("signs and verifies admin session", () => {
    const token = signAdminSession("1", "admin");
    const session = verifyAdminSession(token);
    expect(session).toMatchObject({ id: "1", username: "admin" });
  });

  test("includes the admin auth version in the signed session", () => {
    const token = signAdminSession("1", "admin", 3);
    expect(verifyAdminSession(token)).toMatchObject({ id: "1", username: "admin", authVersion: 3 });
  });

  test("rejects tampered token", () => {
    const token = signAdminSession("1", "admin");
    const bad = `${token}x`;
    expect(verifyAdminSession(bad)).toBeNull();
  });

  test("signs and verifies a student session", () => {
    const token = signStudentSession("student-1");

    expect(verifyStudentSession(token)).toMatchObject({ id: "student-1", authVersion: 0 });
    expect(STUDENT_COOKIE_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test("includes student auth version to revoke sessions after password reset", () => {
    const token = signStudentSession("student-1", 4);

    expect(verifyStudentSession(token)).toMatchObject({ id: "student-1", authVersion: 4 });
  });

  test("keeps instructor sessions longer while retaining shorter director sessions", () => {
    expect(adminSessionMaxAgeMs("instructor")).toBe(INSTRUCTOR_COOKIE_MAX_AGE_MS);
    expect(INSTRUCTOR_COOKIE_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(adminSessionMaxAgeMs("director")).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test("rejects tampered student session", () => {
    const token = signStudentSession("student-1");

    expect(verifyStudentSession(`${token}x`)).toBeNull();
  });
});
