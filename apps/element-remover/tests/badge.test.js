import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBadgeText, isSupportedUrl } from '../src/background/index.js';

test('formatBadgeText formats numbers correctly according to STATUS-BADGE-001', () => {
  assert.equal(formatBadgeText(0), '');
  assert.equal(formatBadgeText(-1), '');
  assert.equal(formatBadgeText(null), '');
  assert.equal(formatBadgeText(1), '1');
  assert.equal(formatBadgeText(7), '7');
  assert.equal(formatBadgeText(99), '99');
  assert.equal(formatBadgeText(100), '99+');
  assert.equal(formatBadgeText(250), '99+');
});

test('isSupportedUrl detects supported http/https/file URLs and rejects restricted browser pages', () => {
  // Supported
  assert.equal(isSupportedUrl('https://example.com/article'), true);
  assert.equal(isSupportedUrl('http://localhost:3000'), true);
  assert.equal(isSupportedUrl('file:///Users/doc.html'), true);

  // Unsupported internal browser pages
  assert.equal(isSupportedUrl('chrome://settings/'), false);
  assert.equal(isSupportedUrl('chrome://extensions/'), false);
  assert.equal(isSupportedUrl('chrome-extension://abcdef123/options.html'), false);
  assert.equal(isSupportedUrl('edge://settings/'), false);
  assert.equal(isSupportedUrl('about:blank'), false);
  assert.equal(isSupportedUrl('devtools://devtools/bundled/inspector.html'), false);

  // Chrome Web Store (restricted by browser)
  assert.equal(isSupportedUrl('https://chromewebstore.google.com/detail/xyz'), false);
  assert.equal(isSupportedUrl('https://chrome.google.com/webstore/category/extensions'), false);
});
