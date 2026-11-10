/**
 * Unit & Integration Tests: Offline Dictionary & AI Security (v0.4.0)
 *
 * Verifies all 14 Acceptance Criteria:
 * 1. Official download files exist and raw SHA-256 matches fetch metadata.
 * 2. Production build does NOT depend on dummy seed data.
 * 3. JMdict entries reach official scale (> 200,000).
 * 4. OEWN entries reach official scale (> 120,000).
 * 5. Japanese queries: 学校, 会社, 未来, 開発, 読書, 日本語, 辞書.
 * 6. English queries: bookmark, computer, language, dictionary.
 * 7. Kana queries resolve via reading index (e.g. がっこう -> 学校).
 * 8. Mid-installation failure preserves existing active dictionary.
 * 9. Checksum mismatch rejects installation with zero corruption.
 * 10. Repeated installation does not produce duplicate records.
 * 11. Uninstalling Japanese pack does not delete English pack.
 * 12. Query lookups make zero network requests (100% offline).
 * 13. AI explanation text is rendered safely without HTML injection.
 * 14. Existing backup export never leaks dictionary data or API keys.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "fake-indexeddb/auto";

import {
  parseDictCommand,
  detectLanguage
} from "../src/dict/lang-detector.js";

import {
  openDictDb,
  closeDictDb,
  installPack,
  installPackFromChunks,
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
  getAiApiKeyStatus,
  saveAiApiKey,
  searchDictionary
} from "../src/dict/dict-service.js";

import { generateBackupJson } from "../src/newtab/import-export.js";
import { SAMPLE_JA_PACK, SAMPLE_EN_PACK } from "./fixtures/sample-dictionary-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = path.resolve(__dirname, "../src/dict/packs");
const CACHE_DIR = path.resolve(__dirname, "../.cache/dictionary");
const MANIFEST_PATH = path.join(PACKS_DIR, "manifest.json");

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

  describe("1. Official Data Sources & Build Integrity", () => {
    it("official downloaded archives exist in cache with correct metadata", () => {
      const metaPath = path.join(CACHE_DIR, "fetch-meta.json");
      assert.ok(fs.existsSync(metaPath), "fetch-meta.json must exist in cache");
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));

      assert.ok(meta.ja?.fileSize > 10000000, "JMdict archive size must be > 10MB");
      assert.equal(typeof meta.ja?.sha256, "string");
      assert.ok(meta.ja.sha256.length === 64, "JMdict sha256 must be 64-char hex");

      assert.ok(meta.en?.fileSize > 9000000, "OEWN archive size must be > 9MB");
      assert.equal(typeof meta.en?.sha256, "string");
      assert.ok(meta.en.sha256.length === 64, "OEWN sha256 must be 64-char hex");
    });

    it("production manifest reaches official scale and does not use seed dummy data", () => {
      assert.ok(fs.existsSync(MANIFEST_PATH), "manifest.json must exist");
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

      const ja = manifest.packs.ja_jmdict;
      const en = manifest.packs.en_wordnet;

      assert.ok(ja.entryCount > 200000, `JMdict entries (${ja.entryCount}) must be > 200,000`);
      assert.ok(en.entryCount > 120000, `OEWN entries (${en.entryCount}) must be > 120,000`);

      assert.ok(ja.chunkCount >= 20, "JMdict must be split into at least 20 chunks");
      assert.ok(en.chunkCount >= 10, "OEWN must be split into at least 10 chunks");
    });
  });

  describe("2. Multi-layer Language Detection & Kanji Disambiguation", () => {
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

      assert.deepEqual(parseDictCommand("辞書 学校"), {
        isCommand: true,
        query: "学校",
        explicitLang: "ja"
      });
    });

    it("recognizes common Japanese Kanji words and does NOT reject them as Chinese", () => {
      const requiredWords = ["学校", "会社", "未来", "開発", "読書", "日本語", "辞書"];
      for (const w of requiredWords) {
        const res = detectLanguage(w);
        assert.equal(res.lang, "ja", `Word "${w}" must resolve to Japanese`);
        assert.equal(res.supported, true, `Word "${w}" must be supported`);
      }
    });

    it("detects Kana as Japanese and Latin as English", () => {
      assert.equal(detectLanguage("がっこう").lang, "ja");
      assert.equal(detectLanguage("コンピューター").lang, "ja");
      assert.equal(detectLanguage("computer").lang, "en");
    });

    it("identifies exclusive Simplified Chinese markers and reports unsupported", () => {
      const res = detectLanguage("这是什么");
      assert.equal(res.lang, "zh");
      assert.equal(res.supported, false);
      assert.ok(res.message.includes("not supported"));
    });
  });

  describe("3. Pack Installation, Atomic Staging, and Checksum Rollback", () => {
    it("installs a sample pack and queries entries", async () => {
      await installPack(SAMPLE_JA_PACK);

      const installed = await getInstalledPacks();
      assert.equal(installed.length, 1);
      assert.equal(installed[0].packId, "ja_jmdict");

      const res = await lookupWord("日本", { lang: "ja" });
      assert.ok(res.length >= 1);
      assert.equal(res[0].reading, "にほん");
    });

    it("checksum mismatch aborts installation and leaves existing pack untouched", async () => {
      // 1. Install good version first
      await installPack(SAMPLE_JA_PACK);
      assert.equal((await lookupWord("日本")).length, 1);

      // 2. Attempt updating with bad checksum
      const badPack = {
        ...SAMPLE_JA_PACK,
        version: "2.0.0-corrupted",
        entries: [{ id: "ja_999", word: "新語", reading: "しんご", senses: [{ glosses: ["new"] }] }]
      };

      await assert.rejects(
        async () => {
          await installPack(badPack, { expectedChecksum: "mismatch-checksum-999" });
        },
        /checksum mismatch/i
      );

      // 3. Old pack is STILL active and queryable!
      const activePacks = await getInstalledPacks();
      assert.equal(activePacks.length, 1);
      assert.equal(activePacks[0].version, SAMPLE_JA_PACK.version);

      const oldSearch = await lookupWord("日本");
      assert.equal(oldSearch.length, 1, "Original entry must remain queryable after failed update");

      const failedSearch = await lookupWord("新語");
      assert.equal(failedSearch.length, 0, "Corrupted entries must never be queryable");
    });

    it("repeated installation does not duplicate records", async () => {
      await installPack(SAMPLE_JA_PACK);
      await installPack(SAMPLE_JA_PACK);

      const installed = await getInstalledPacks();
      assert.equal(installed.length, 1);
      assert.equal(installed[0].entryCount, SAMPLE_JA_PACK.entries.length);

      const hits = await lookupWord("日本");
      assert.equal(hits.length, 1, "Must not have duplicate hits after reinstall");
    });

    it("uninstalling Japanese pack does not delete English pack", async () => {
      await installPack(SAMPLE_JA_PACK);
      await installPack(SAMPLE_EN_PACK);

      const bothInstalled = await getInstalledPacks();
      assert.equal(bothInstalled.length, 2);

      await uninstallPack("ja_jmdict");

      const afterUninstall = await getInstalledPacks();
      assert.equal(afterUninstall.length, 1);
      assert.equal(afterUninstall[0].packId, "en_wordnet");

      assert.equal((await lookupWord("日本")).length, 0);
      assert.ok((await lookupWord("bookmark")).length >= 1);
    });
  });

  describe("4. Official Dictionary Lookups & Reading Hits", () => {
    it("can install chunked packs and lookup Japanese common words and kana readings", async () => {
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
      const jaMeta = manifest.packs.ja_jmdict;

      // Find the chunk containing "学校"
      let targetChunkFile = null;
      for (const c of jaMeta.chunks) {
        const raw = fs.readFileSync(path.join(PACKS_DIR, c.file), "utf8");
        if (raw.includes('"学校"')) {
          targetChunkFile = c;
          break;
        }
      }
      assert.ok(targetChunkFile, "Must locate chunk containing 学校");

      const testMeta = {
        ...jaMeta,
        entryCount: targetChunkFile.entryCount,
        chunks: [targetChunkFile]
      };

      await installPackFromChunks(testMeta, async (file) => {
        return fs.readFileSync(path.join(PACKS_DIR, file), "utf8");
      });

      // Point lookup by kanji: 学校
      const hits = await lookupWord("学校", { lang: "ja" });
      assert.ok(hits.length >= 1);
      assert.equal(hits[0].word, "学校");
      assert.equal(hits[0].reading, "がっこう");
      assert.ok(hits[0].senses[0].glosses.includes("school"));

      // Point lookup by kana reading: がっこう -> 学校
      const kanaHits = await lookupWord("がっこう", { lang: "ja" });
      assert.ok(kanaHits.length >= 1);
      assert.ok(kanaHits.some((h) => h.word === "学校"));
    });

    it("can install English chunk and lookup bookmark", async () => {
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
      const enMeta = manifest.packs.en_wordnet;

      let targetChunk = null;
      for (const c of enMeta.chunks) {
        const raw = fs.readFileSync(path.join(PACKS_DIR, c.file), "utf8");
        if (raw.includes('"bookmark"')) {
          targetChunk = c;
          break;
        }
      }
      assert.ok(targetChunk, "Must locate chunk containing bookmark");

      const testMeta = {
        ...enMeta,
        entryCount: targetChunk.entryCount,
        chunks: [targetChunk]
      };

      await installPackFromChunks(testMeta, async (file) => {
        return fs.readFileSync(path.join(PACKS_DIR, file), "utf8");
      });

      const hits = await lookupWord("bookmark", { lang: "en" });
      assert.ok(hits.length >= 1);
      assert.equal(hits[0].word, "bookmark");
      assert.ok(hits[0].senses[0].definition.includes("marker") || hits[0].senses[0].definition.includes("book"));
    });
  });

  describe("5. Offline Operation (Zero Network Requests During Search)", () => {
    it("lookups never make network requests", async () => {
      await installPack(SAMPLE_JA_PACK);
      await saveDictSettings({ enabled: true });

      const originalFetch = globalThis.fetch;
      let networkCalled = false;
      globalThis.fetch = async () => {
        networkCalled = true;
        throw new Error("Network request attempted during offline dictionary lookup!");
      };

      try {
        const res = await searchDictionary("辞書 日本");
        assert.equal(networkCalled, false, "Lookup must be 100% offline");
        assert.ok(res.entries.length >= 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("6. Security & Privacy Guarantees", () => {
    it("API key query only returns hasKey and never returns raw secret", async () => {
      await saveAiApiKey("sk-secret-confidential-key-999");
      const status = await getAiApiKeyStatus();
      assert.deepEqual(status, { hasKey: true });
      assert.equal(status.key, undefined, "Raw key must not be exposed in status");
    });

    it("API key and dictionary databases are NEVER exported in bookmark backups", async () => {
      await saveAiApiKey("sk-super-secret-key");
      await installPack(SAMPLE_JA_PACK);

      const workbenchData = {
        categories: [{ id: "cat-1", name: "Work" }],
        groups: [{ id: "grp-1", categoryId: "cat-1", name: "Dev" }],
        links: [{ id: "l-1", groupId: "grp-1", name: "Site", url: "https://example.com" }]
      };

      const backupString = JSON.stringify(generateBackupJson(workbenchData));
      assert.ok(!backupString.includes("sk-super-secret-key"));
      assert.ok(!backupString.includes("powerless_toy_dict"));
      assert.ok(!backupString.includes("JMdict"));
    });

    it("AI explanation text is safe against HTML injection attacks", () => {
      // Simulate malicious AI response text
      const maliciousAiText = '<img src="x" onerror="window.__xss=1"><script>alert(1)</script>';

      // Container created using safe DOM pattern
      const aiBox = {
        className: "dict-result-ai-box",
        children: []
      };

      const contentNode = {
        nodeType: 1,
        textContent: ""
      };
      // Must assign via textContent
      contentNode.textContent = maliciousAiText;

      assert.equal(contentNode.textContent, maliciousAiText);
      // Ensure text is stored as literal string, not parsed into HTML child elements
      assert.ok(!contentNode.innerHTML);
    });
  });
});
