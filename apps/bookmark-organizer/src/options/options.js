/**
 * Options page script
 */

async function initOptionsDiagnostics() {
  try {
    const buildInfoUrl = typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? chrome.runtime.getURL("src/build-info.json")
      : "../build-info.json";
    const res = await fetch(buildInfoUrl);
    if (res.ok) {
      const info = await res.json();
      const buildIdEl = document.getElementById("buildId");
      if (buildIdEl && info?.commit) {
        buildIdEl.textContent = `${info.commit}${info.target ? ` (${info.target})` : ""}`;
      }
    }
  } catch {}
}

initOptionsDiagnostics();
console.log("Bookmark Organizer options loaded.");
