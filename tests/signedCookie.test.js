const { signAdminSession, verifyAdminSession } = require("../src/lib/signedCookie");

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

  test("rejects tampered token", () => {
    const token = signAdminSession("1", "admin");
    const bad = `${token}x`;
    expect(verifyAdminSession(bad)).toBeNull();
  });
});
