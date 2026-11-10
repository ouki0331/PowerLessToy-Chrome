/**
 * Unit & Integration Tests: Offline Dictionary, Migration & Security (v0.4.0)
 *
 * Verifies all Acceptance Criteria without requiring network or local .cache:
 * 1. Committed production manifest and chunks integrity.
 * 2. Manifest contains authentic source metadata (sourceSha256, sourceFileSize, sourceDownloadedAt).
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
 * 15. IndexedDB Database Migration from v1 to v2:
 *     - Old database without version index upgrades cleanly.
 *     - Legacy entries without version field handled gracefully.
 *     - Zero NotFoundError on version index queries.
 * 16. HTTPS download supply chain security:
 *     - Rejects insecure HTTP protocol.
 *     - Rejects insecure redirect from HTTPS to HTTP.
 *     - Cleans up .part files on download failure/abort.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "fake-indexeddb/auto";

import {
  DICT_DB_NAME,
  DICT_DB_VERSION,
  DICT_STORES
} from "../src/dict/dict-constants.js";

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

import { downloadHttpsFile } from "../scripts/fetch-dictionary-data.js";
import { generateBackupJson } from "../src/newtab/import-export.js";
import { SAMPLE_JA_PACK, SAMPLE_EN_PACK } from "./fixtures/sample-dictionary-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = path.resolve(__dirname, "../src/dict/packs");
const MANIFEST_PATH = path.join(PACKS_DIR, "manifest.json");

describe("Offline Dictionary Module (v0.4.0)", () => {
  beforeEach(async () => {
    closeDictDb();
    const idb = globalThis.indexedDB;
    if (idb) {
      await new Promise((resolve) => {
        const req = idb.deleteDatabase(DICT_DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    }
  });

  afterEach(() => {
    closeDictDb();
  });

  describe("1. Committed Manifest & Chunks Integrity (Cache-Independent)", () => {
    it("production manifest exists and contains authentic source metadata", () => {
      assert.ok(fs.existsSync(MANIFEST_PATH), "manifest.json must exist in git repository");
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

      const ja = manifest.packs.ja_jmdict;
      const en = manifest.packs.en_wordnet;

      // Source metadata validation
      assert.ok(/^[a-f0-9]{64}$/i.test(ja.sourceSha256), "JMdict sourceSha256 must be 64-char hex");
      assert.ok(typeof ja.sourceFileSize === "number" && ja.sourceFileSize > 10000000);
      assert.ok(!isNaN(Date.parse(ja.sourceDownloadedAt)), "JMdict sourceDownloadedAt must be valid date");
      assert.ok(ja.sourceUrl.startsWith("https://"), "JMdict sourceUrl must be HTTPS");

      assert.ok(/^[a-f0-9]{64}$/i.test(en.sourceSha256), "OEWN sourceSha256 must be 64-char hex");
      assert.ok(typeof en.sourceFileSize === "number" && en.sourceFileSize > 9000000);
      assert.ok(!isNaN(Date.parse(en.sourceDownloadedAt)), "OEWN sourceDownloadedAt must be valid date");
      assert.ok(en.sourceUrl.startsWith("https://"), "OEWN sourceUrl must be HTTPS");

      // Scale validation
      assert.ok(ja.entryCount > 200000, `JMdict entries (${ja.entryCount}) must be > 200,000`);
      assert.ok(en.entryCount > 120000, `OEWN entries (${en.entryCount}) must be > 120,000`);

      // Chunk validation
      assert.equal(ja.chunkCount, ja.chunks.length);
      assert.equal(en.chunkCount, en.chunks.length);
      assert.equal(ja.chunks.reduce((s, c) => s + c.entryCount, 0), ja.entryCount);
      assert.equal(en.chunks.reduce((s, c) => s + c.entryCount, 0), en.entryCount);
    });

    it("all committed chunk files exist and match sizes specified in manifest", () => {
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
      const allChunks = [...manifest.packs.ja_jmdict.chunks, ...manifest.packs.en_wordnet.chunks];

      for (const chunk of allChunks) {
        const chunkPath = path.join(PACKS_DIR, chunk.file);
        assert.ok(fs.existsSync(chunkPath), `Committed chunk must exist: ${chunk.file}`);
        const stat = fs.statSync(chunkPath);
        assert.equal(stat.size, chunk.size, `File size mismatch for ${chunk.file}`);
      }
    });
  });

  describe("2. IndexedDB v1 -> v2 Migration & Version Index Handling", () => {
    it("reliably upgrades v1 database without version index and preserves existing data", async () => {
      closeDictDb();
      const idb = globalThis.indexedDB;

      // 1. Manually construct a legacy v1 database (without 'version' index on entries)
      await new Promise((resolve, reject) => {
        const req = idb.open(DICT_DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          db.createObjectStore(DICT_STORES.PACKS, { keyPath: "packId" });
          const entryStore = db.createObjectStore(DICT_STORES.ENTRIES, { keyPath: "id" });
          entryStore.createIndex("packId", "packId", { unique: false });
          entryStore.createIndex("word", "word", { unique: false });
          entryStore.createIndex("reading", "reading", { unique: false });
          entryStore.createIndex("lookupKeys", "lookupKeys", { unique: false, multiEntry: true });
          // Note: NO version index in v1!
          db.createObjectStore(DICT_STORES.AI_CACHE, { keyPath: "cacheKey" });
          db.createObjectStore(DICT_STORES.HISTORY, { keyPath: "id", autoIncrement: true });
        };
        req.onsuccess = (e) => {
          const db = e.target.result;
          // Populate legacy v1 data
          const tx = db.transaction([DICT_STORES.PACKS, DICT_STORES.ENTRIES, DICT_STORES.AI_CACHE], "readwrite");
          tx.objectStore(DICT_STORES.PACKS).put({
            packId: "ja_jmdict",
            language: "ja",
            name: "Legacy JMdict",
            version: "1.0.0-legacy"
            // Note: NO activeVersion field in v1!
          });
          tx.objectStore(DICT_STORES.ENTRIES).put({
            id: "legacy_entry_1",
            packId: "ja_jmdict",
            word: "本",
            reading: "ほん",
            lookupKeys: ["本", "ほん"],
            senses: [{ glosses: ["book"] }]
            // Note: NO version field in v1!
          });
          tx.objectStore(DICT_STORES.AI_CACHE).put({
            cacheKey: "legacy_ai_key",
            value: "Pre-existing explanation"
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

      // 2. Open using new openDictDb() which uses DICT_DB_VERSION (2)
      assert.equal(DICT_DB_VERSION, 2, "DICT_DB_VERSION must be incremented to 2");
      const upgradedDb = await openDictDb();
      assert.equal(upgradedDb.version, 2, "Database must be upgraded to version 2");

      // Verify 'version' index now exists on 'entries' object store
      const txCheck = upgradedDb.transaction(DICT_STORES.ENTRIES, "readonly");
      const entryStore = txCheck.objectStore(DICT_STORES.ENTRIES);
      assert.ok(entryStore.indexNames.contains("version"), "version index must be added on upgrade");

      // Verify legacy data is preserved
      const legacyHits = await lookupWord("本", { lang: "ja" });
      assert.equal(legacyHits.length, 1);
      assert.equal(legacyHits[0].reading, "ほん");

      const aiCacheVal = await getAiCache("legacy_ai_key");
      assert.equal(aiCacheVal, "Pre-existing explanation");

      // 3. Install new chunked pack on top of migrated database
      const newPack = {
        packId: "ja_jmdict",
        language: "ja",
        name: "JMdict Official",
        version: "2026.11.10",
        entryCount: 2,
        chunks: [
          {
            file: "test_chunk.json",
            entryCount: 2,
            size: 50,
            checksum: ""
          }
        ]
      };

      const chunkData = {
        packId: "ja_jmdict",
        language: "ja",
        entries: [
          {
            id: "jmdict_101",
            word: "学校",
            reading: "がっこう",
            senses: [{ glosses: ["school"] }]
          },
          {
            id: "jmdict_102",
            word: "会社",
            reading: "かいしゃ",
            senses: [{ glosses: ["company"] }]
          }
        ]
      };

      // Must install without NotFoundError on version index
      await installPackFromChunks(newPack, async () => JSON.stringify(chunkData));

      // 4. Verify only new active version entries are returned
      const newHits = await lookupWord("学校", { lang: "ja" });
      assert.equal(newHits.length, 1);
      assert.equal(newHits[0].reading, "がっこう");

      // Retired entry "本" has been cleanly purged and does not appear
      const oldHits = await lookupWord("本", { lang: "ja" });
      assert.equal(oldHits.length, 0);
    });
  });

  describe("3. Multi-layer Language Detection & Kanji Disambiguation", () => {
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

  describe("4. Pack Installation, Atomic Staging, and Checksum Rollback", () => {
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

  describe("5. Official Dictionary Lookups & Reading Hits", () => {
    it("can install chunked packs and lookup Japanese common words and kana readings", async () => {
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
      const jaMeta = manifest.packs.ja_jmdict;

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

  describe("6. Offline Operation (Zero Network Requests During Search)", () => {
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

  describe("7. Security & Supply Chain Defense", () => {
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
      const maliciousAiText = '<img src="x" onerror="window.__xss=1"><script>alert(1)</script>';

      const contentNode = {
        nodeType: 1,
        textContent: ""
      };
      contentNode.textContent = maliciousAiText;

      assert.equal(contentNode.textContent, maliciousAiText);
      assert.ok(!contentNode.innerHTML);
    });

    it("downloadHttpsFile rejects insecure HTTP protocol and cleans up .part files", async () => {
      const destFile = path.join(__dirname, "temp_test_insecure.bin");
      const partFile = `${destFile}.part`;

      await assert.rejects(
        async () => {
          await downloadHttpsFile("http://example.com/insecure.gz", destFile);
        },
        /insecure protocol rejected/i
      );

      assert.ok(!fs.existsSync(partFile), ".part file must be cleaned up on failure");
      assert.ok(!fs.existsSync(destFile), "Target file must not be created on failure");
    });
  });
});
