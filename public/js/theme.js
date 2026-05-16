(function () {
  var COOKIE = "theme";
  var MAX_AGE = 365 * 24 * 60 * 60;

  function readCookie() {
    var m = document.cookie.match(new RegExp("(?:^|; )" + COOKIE + "=([^;]+)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function writeCookie(value) {
    document.cookie =
      COOKIE + "=" + encodeURIComponent(value) + ";path=/;max-age=" + MAX_AGE + ";SameSite=Lax";
  }

  function applyTheme(theme) {
    if (theme !== "dark" && theme !== "light") return;
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      var isDark = theme === "dark";
      btn.setAttribute("aria-pressed", isDark ? "true" : "false");
      btn.setAttribute("aria-label", btn.getAttribute(isDark ? "data-label-light" : "data-label-dark") || "");
    });
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute("data-theme") || "light";
    var next = current === "dark" ? "light" : "dark";
    writeCookie(next);
    applyTheme(next);
  }

  window.__siteToggleTheme = toggleTheme;

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-theme-toggle]");
    if (btn) {
      e.preventDefault();
      toggleTheme();
    }
  });
})();
