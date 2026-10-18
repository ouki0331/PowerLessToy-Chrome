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
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url: "chrome://newtab" });
    } else {
      window.open("../newtab/index.html", "_blank");
    }
  });
});
