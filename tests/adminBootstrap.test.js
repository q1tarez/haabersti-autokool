const { initializeAdmins } = require("../src/db/adminBootstrap");

describe("admin bootstrap credential migration", () => {
  const previousUsername = process.env.ADMIN_USERNAME;
  const previousPassword = process.env.ADMIN_PASSWORD;
  const previousForceReset = process.env.ADMIN_FORCE_PASSWORD_RESET;
  let warnSpy;

  beforeEach(() => {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_FORCE_PASSWORD_RESET;
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (previousUsername === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = previousUsername;
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
    if (previousForceReset === undefined) delete process.env.ADMIN_FORCE_PASSWORD_RESET;
    else process.env.ADMIN_FORCE_PASSWORD_RESET = previousForceReset;
    warnSpy.mockRestore();
  });

  test("does not rotate legacy admin credentials until replacement credentials are configured", async () => {
    const writes = [];
    const getAsync = jest.fn(async (sql) => {
      if (sql.includes("security_migrations")) return null;
      return { id: 1 };
    });
    const runAsync = jest.fn(async (sql) => {
      writes.push(sql);
      return {};
    });

    await initializeAdmins({ getAsync, runAsync });

    expect(writes).toEqual([
      expect.stringContaining("CREATE TABLE IF NOT EXISTS security_migrations"),
    ]);
    expect(writes.some((sql) => sql.includes("UPDATE admins SET password_hash"))).toBe(false);
    expect(writes.some((sql) => sql.includes("INSERT INTO security_migrations"))).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipped legacy admin credential rotation")
    );
  });

  test("does not overwrite a password changed in account settings on each startup", async () => {
    process.env.ADMIN_USERNAME = "known-admin";
    process.env.ADMIN_PASSWORD = "environment-bootstrap-password";
    const runAsync = jest.fn(async () => ({}));
    const getAsync = jest.fn(async (sql) => {
      if (sql.includes("security_migrations")) return { id: "remove-embedded-admin-credentials" };
      return { id: 5 };
    });

    await initializeAdmins({ getAsync, runAsync });

    expect(runAsync).not.toHaveBeenCalledWith(
      "UPDATE admins SET password_hash = ? WHERE id = ?",
      expect.any(Array)
    );
  });

  test("supports an explicit one-time password reset from environment credentials", async () => {
    process.env.ADMIN_USERNAME = "known-admin";
    process.env.ADMIN_PASSWORD = "environment-bootstrap-password";
    process.env.ADMIN_FORCE_PASSWORD_RESET = "1";
    const runAsync = jest.fn(async () => ({}));
    const getAsync = jest.fn(async (sql) => {
      if (sql.includes("security_migrations")) return { id: "remove-embedded-admin-credentials" };
      return { id: 5 };
    });

    await initializeAdmins({ getAsync, runAsync });

    expect(runAsync).toHaveBeenCalledWith(
      expect.stringContaining("auth_version = auth_version + 1"),
      [expect.any(String), 5]
    );
  });
});
