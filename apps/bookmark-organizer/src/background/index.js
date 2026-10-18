/**
 * Background Service Worker for Bookmark Organizer
 * Manifest V3 entrypoint
 */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    // Extension installed - default data will be initialized on first newtab open
    console.log("PowerLessToy Bookmark Organizer installed successfully.");
  }
});
