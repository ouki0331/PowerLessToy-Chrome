import { loadWorkbenchData } from "../newtab/storage.js";

document.addEventListener("DOMContentLoaded", async () => {
  const catCountEl = document.getElementById("catCount");
  const groupCountEl = document.getElementById("groupCount");
  const linkCountEl = document.getElementById("linkCount");
  const openNewTabBtn = document.getElementById("openNewTabBtn");

  try {
    const data = await loadWorkbenchData();
    if (data) {
      catCountEl.textContent = data.categories?.length || 0;
      groupCountEl.textContent = data.groups?.length || 0;
      linkCountEl.textContent = data.links?.length || 0;
    }
  } catch (err) {
    console.error("Failed to load workbench counts", err);
  }

  openNewTabBtn?.addEventListener("click", () => {
    const newTabUrl =
      typeof chrome !== "undefined" && chrome.runtime?.getURL
        ? chrome.runtime.getURL("src/newtab/index.html")
        : typeof browser !== "undefined" && browser.runtime?.getURL
          ? browser.runtime.getURL("src/newtab/index.html")
          : "../newtab/index.html";

    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url: newTabUrl });
    } else if (typeof browser !== "undefined" && browser.tabs?.create) {
      browser.tabs.create({ url: newTabUrl });
    } else {
      window.open(newTabUrl, "_blank");
    }
  });
});
