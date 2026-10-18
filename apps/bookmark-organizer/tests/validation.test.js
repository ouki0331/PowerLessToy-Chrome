import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isValidUrl } from "../src/newtab/storage.js";

describe("Bookmark Organizer - Validation Logic", () => {
  it("accepts valid http and https URLs", () => {
    assert.equal(isValidUrl("https://github.com"), true);
    assert.equal(isValidUrl("http://localhost:8080/dashboard"), true);
    assert.equal(isValidUrl("https://sub.domain.co.uk:9000/path?query=1#hash"), true);
  });

  it("accepts internal browser and local protocols", () => {
    assert.equal(isValidUrl("chrome://extensions"), true);
    assert.equal(isValidUrl("file:///Users/username/doc.html"), true);
    assert.equal(isValidUrl("ftp://ftp.example.com/files"), true);
  });

  it("rejects invalid, unsafe, or malformed URLs", () => {
    assert.equal(isValidUrl(""), false);
    assert.equal(isValidUrl("   "), false);
    assert.equal(isValidUrl(null), false);
    assert.equal(isValidUrl(undefined), false);
    assert.equal(isValidUrl("just-text"), false);
    assert.equal(isValidUrl("javascript:alert(1)"), false);
    assert.equal(isValidUrl("data:text/html,<b>hi</b>"), false);
  });
});
