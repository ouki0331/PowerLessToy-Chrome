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

if (typeof chrome !== "undefined" && chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "open-bookmark-search") return;

    try {
      // Broadcast to any open Bookmark Organizer New Tab page
      await chrome.runtime.sendMessage({ type: "OPEN_BOOKMARK_SEARCH" }).catch(() => null);
    } catch {
      // Ignore if no extension page listener is currently active
    }
  });
}
