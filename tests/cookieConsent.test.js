const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ejs = require("ejs");

const templatePath = path.join(
  __dirname,
  "..",
  "views",
  "partials",
  "cookie-banner.ejs"
);

function renderCookieBanner(savedConsent) {
  const template = fs.readFileSync(templatePath, "utf8");
  const html = ejs.render(template, { lang: "et", gaId: "G-TEST" });
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  const values = new Map();
  const appendedScripts = [];
  const handlers = {};
  const banner = { hidden: true, dataset: { gaId: "G-TEST" } };
  const acceptButton = {
    addEventListener: (event, handler) => {
      handlers.accept = handler;
    },
  };
  const rejectButton = {
    addEventListener: (event, handler) => {
      handlers.reject = handler;
    },
  };

  if (savedConsent) values.set("haabersti_cookie_consent", savedConsent);

  const document = {
    getElementById(id) {
      return {
        cookieBanner: banner,
        cookieAccept: acceptButton,
        cookieReject: rejectButton,
      }[id];
    },
    createElement() {
      return {};
    },
    head: {
      appendChild(script) {
        appendedScripts.push(script);
      },
    },
  };

  if (!scriptMatch) throw new Error("Cookie banner script was not rendered");

  vm.runInNewContext(scriptMatch[1], {
    document,
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    },
    window: {},
    console,
    Date,
    encodeURIComponent,
  });

  return { banner, appendedScripts, handlers, values };
}

describe("cookie consent", () => {
  test("shows the banner and does not load analytics without a saved choice", () => {
    const result = renderCookieBanner(null);

    expect(result.banner.hidden).toBe(false);
    expect(result.appendedScripts).toHaveLength(0);
  });

  test("loads analytics after the visitor accepts", () => {
    const result = renderCookieBanner(null);

    result.handlers.accept();

    expect(result.values.get("haabersti_cookie_consent")).toBe("accepted");
    expect(result.banner.hidden).toBe(true);
    expect(result.appendedScripts).toHaveLength(1);
    expect(result.appendedScripts[0].src).toContain("id=G-TEST");
  });

  test("saves rejection without loading analytics", () => {
    const result = renderCookieBanner(null);

    result.handlers.reject();

    expect(result.values.get("haabersti_cookie_consent")).toBe("rejected");
    expect(result.banner.hidden).toBe(true);
    expect(result.appendedScripts).toHaveLength(0);
  });

  test("restores an accepted choice and loads analytics", () => {
    const result = renderCookieBanner("accepted");

    expect(result.banner.hidden).toBe(true);
    expect(result.appendedScripts).toHaveLength(1);
  });

  test("restores a rejected choice without loading analytics", () => {
    const result = renderCookieBanner("rejected");

    expect(result.banner.hidden).toBe(true);
    expect(result.appendedScripts).toHaveLength(0);
  });
});
