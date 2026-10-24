// Fast synchronous theme application to prevent FOUC (CSP compliant external script)
try {
  const mode = localStorage.getItem("powerless_toy_theme_mode") || "system";
  document.documentElement.setAttribute("data-theme", mode);
  let resolved = "light";
  if (mode === "dark") {
    resolved = "dark";
  } else if (mode === "light") {
    resolved = "light";
  } else if (mode === "auto") {
    const hour = new Date().getHours();
    resolved = (hour >= 7 && hour < 18) ? "light" : "dark";
  } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    resolved = "dark";
  }
  document.documentElement.setAttribute("data-resolved-theme", resolved);
  document.documentElement.style.colorScheme = resolved;
} catch {
  // Graceful fallback
}
