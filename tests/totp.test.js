const { generateSecret, verifyTotp, totp } = require("../src/lib/totp");

describe("totp", () => {
  it("generates and verifies a code", () => {
    const secret = generateSecret();
    const code = totp(secret);
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(secret, "000000")).toBe(false);
  });
});
