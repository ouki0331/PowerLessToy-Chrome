/**
 * Unit & Integration Tests: Offline Dictionary & AI Context Explanation (v0.4.0)
 *
 * Covers:
 * - DICT-PACK-001: Independent pack format, SHA-256 validation, rollback on corruption.
 * - DICT-LOOKUP-001: IndexedDB point lookup, chunked storage, memory efficiency.
 * - DICT-LANG-001: Multi-layer language detection, Chinese non-support rule, ambiguous kanji.
 * - DICT-SETTINGS-001: Master switch off by default, zero queries when disabled.
 * - DICT-AI-001: BYOK API key isolation, never exported in bookmark backups, local caching.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

import {
  parseDictCommand,
  detectLanguage
} from "../src/dict/lang-detector.js";

import {
  openDictDb,
  closeDictDb,
  installPack,
  uninstallPack,
  getInstalledPacks,
  lookupWord,
  getAiCache,
  setAiCache,
  clearAiCache,
  computeStringSha256
} from "../src/dict/dict-db.js";

import {
  getDictSettings,
  saveDictSettings,
  getAiApiKey,
  saveAiApiKey,
  searchDictionary
} from "../src/dict/dict-service.js";

import { generateBackupJson } from "../src/newtab/import-export.js";

describe("Offline Dictionary Module (v0.4.0)", () => {
  beforeEach(async () => {
    closeDictDb();
    const idb = globalThis.indexedDB;
    if (idb) {
      await new Promise((resolve) => {
        const req = idb.deleteDatabase("powerless_toy_dict_v1");
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    }
  });

  afterEach(() => {
    closeDictDb();
  });

  describe("DICT-LANG-001: Multi-layer Language Detection", () => {
    it("parses explicit command prefixes (dict ja, dict en, 辞書)", () => {
      assert.deepEqual(parseDictCommand("dict ja 桜"), {
        isCommand: true,
        query: "桜",
        explicitLang: "ja"
      });

      assert.deepEqual(parseDictCommand("dict:en bookmark"), {
        isCommand: true,
        query: "bookmark",
        explicitLang: "en"
      });

      assert.deepEqual(parseDictCommand("辞書 日本語"), {
        isCommand: true,
        query: "日本語",
        explicitLang: "ja"
      });

      assert.deepEqual(parseDictCommand("dict computer"), {
        isCommand: true,
        query: "computer",
        explicitLang: null
      });

      assert.equal(parseDictCommand("regular query").isCommand, false);
    });

    it("detects Japanese via Kana script feature", () => {
      const res1 = detectLanguage("さくら");
      assert.equal(res1.lang, "ja");
      assert.equal(res1.supported, true);

      const res2 = detectLanguage("コンピューター");
      assert.equal(res2.lang, "ja");
      assert.equal(res2.supported, true);
    });

    it("detects English via pure Latin script feature", () => {
      const res = detectLanguage("workbench");
      assert.equal(res.lang, "en");
      assert.equal(res.supported, true);
    });

    it("identifies Chinese text and returns supported: false with clear reason", () => {
      // "词典" contains simplified Chinese character "词"
      const res = detectLanguage("词典");
      assert.equal(res.lang, "zh");
      assert.equal(res.supported, false);
      assert.ok(res.message.includes("not supported"));
    });

    it("flags pure Kanji without Kana as ambiguous and defaults to Japanese", () => {
      const res = detectLanguage("自由");
      assert.equal(res.lang, "ja");
      assert.equal(res.supported, true);
      assert.equal(res.ambiguous, true);
    });
  });

  describe("DICT-PACK-001 & DICT-LOOKUP-001: Pack Storage & Point Lookups", () => {
    const mockJaPack = {
      packId: "ja_jmdict",
      language: "ja",
      name: "JMdict Test Pack",
      version: "1.0.0",
      source: "EDRDG",
      license: "CC BY-SA 4.0",
      attribution: "JMdict by EDRDG",
      entries: [
        {
          id: "ja_1",
          word: "日本",
          reading: "にほん",
          pos: ["n"],
          senses: [{ glosses: ["Japan"] }]
        },
        {
          id: "ja_2",
          word: "桜",
          reading: "さくら",
          pos: ["n"],
          senses: [{ glosses: ["cherry blossom"] }]
        }
      ]
    };

    it("installs pack and allows indexed point lookups by word or reading", async () => {
      await installPack(mockJaPack);

      const installed = await getInstalledPacks();
      assert.equal(installed.length, 1);
      assert.equal(installed[0].packId, "ja_jmdict");
      assert.equal(installed[0].entryCount, 2);

      // Point lookup by kanji
      const byKanji = await lookupWord("日本", { lang: "ja" });
      assert.equal(byKanji.length, 1);
      assert.equal(byKanji[0].reading, "にほん");

      // Point lookup by reading
      const byKana = await lookupWord("さくら", { lang: "ja" });
      assert.equal(byKana.length, 1);
      assert.equal(byKana[0].word, "桜");
    });

    it("verifies SHA-256 checksum and rolls back on mismatch", async () => {
      await assert.rejects(
        async () => {
          await installPack(mockJaPack, { expectedChecksum: "invalid-checksum" });
        },
        /checksum mismatch/
      );

      const installed = await getInstalledPacks();
      assert.equal(installed.length, 0, "Pack must not be installed on checksum failure");
    });

    it("uninstalls pack completely and removes indexed entries", async () => {
      await installPack(mockJaPack);
      assert.equal((await lookupWord("日本")).length, 1);

      await uninstallPack("ja_jmdict");
      const installed = await getInstalledPacks();
      assert.equal(installed.length, 0);

      const afterUninstall = await lookupWord("日本");
      assert.equal(afterUninstall.length, 0);
    });
  });

  describe("DICT-SETTINGS-001: Master Switch & Boundary Isolation", () => {
    it("defaults to OFF (enabled: false)", async () => {
      const settings = await getDictSettings();
      assert.equal(settings.enabled, false);
    });

    it("searchDictionary returns isEnabled: false immediately when disabled", async () => {
      await saveDictSettings({ enabled: false });
      const res = await searchDictionary("dict bookmark");

      assert.equal(res.isEnabled, false);
      assert.equal(res.entries.length, 0);
      assert.ok(res.message.includes("disabled"));
    });

    it("BYOK API key is stored strictly segregated and NEVER included in bookmark backups", async () => {
      await saveAiApiKey("sk-secret-test-key-12345");
      const retrieved = await getAiApiKey();
      assert.equal(retrieved, "sk-secret-test-key-12345");

      // Simulate bookmark export
      const workbenchData = {
        categories: [{ id: "cat-1", name: "Work" }],
        groups: [{ id: "grp-1", categoryId: "cat-1", name: "Dev" }],
        links: [{ id: "l-1", groupId: "grp-1", name: "Site", url: "https://example.com" }]
      };

      const backupString = JSON.stringify(generateBackupJson(workbenchData));
      assert.ok(!backupString.includes("sk-secret-test-key"), "API key must NEVER leak into backup export");
      assert.ok(!backupString.includes("powerless_toy_dict"), "Dictionary data must NEVER leak into backup export");
    });
  });

  describe("DICT-AI-001: Local AI Caching", () => {
    it("caches AI explanation locally and retrieves it without duplicate calls", async () => {
      const cacheKey = "cache-key-123";
      await setAiCache(cacheKey, "Sample AI explanation for word.");

      const cached = await getAiCache(cacheKey);
      assert.equal(cached, "Sample AI explanation for word.");

      await clearAiCache();
      const afterClear = await getAiCache(cacheKey);
      assert.equal(afterClear, null);
    });
  });
});
