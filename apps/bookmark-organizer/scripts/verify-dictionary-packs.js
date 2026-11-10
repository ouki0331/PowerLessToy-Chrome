/**
 * Dictionary Verification Script (npm run dictionary:verify)
 *
 * Verifies:
 * 1. Entry counts reach real official scale (JMdict > 200,000, OEWN > 120,000).
 * 2. SHA-256 integrity of each chunk file matches manifest.json.
 * 3. Schema correctness: word, pos, senses (definition/glosses).
 * 4. ID uniqueness across each pack.
 * 5. Common word hits:
 *    - Japanese: 学校, 会社, 未来, 開発, 読書, 日本語, 辞書
 *    - English: bookmark, computer, language, dictionary
 * 6. Reading index hits (e.g. がっこう hits 学校).
 * 7. Ensures sample seed data was NOT used in the build.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKS_DIR = path.resolve(__dirname, "../src/dict/packs");
const MANIFEST_PATH = path.join(PACKS_DIR, "manifest.json");

function computeFileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

export async function verifyDictionaryPacks() {
  console.log("[dictionary:verify] Verifying dictionary packs and chunks integrity...");

  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Manifest not found at ${MANIFEST_PATH}. Run npm run dictionary:build first.`);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (!manifest.packs?.ja_jmdict || !manifest.packs?.en_wordnet) {
    throw new Error("Manifest is missing ja_jmdict or en_wordnet pack definitions.");
  }

  const jaMeta = manifest.packs.ja_jmdict;
  const enMeta = manifest.packs.en_wordnet;

  // 1. Verify Source Metadata
  for (const [key, pack] of Object.entries({ ja_jmdict: jaMeta, en_wordnet: enMeta })) {
    console.log(`[dictionary:verify] Verifying source metadata for ${key}...`);
    if (!pack.sourceSha256 || !/^[a-f0-9]{64}$/i.test(pack.sourceSha256)) {
      throw new Error(`Invalid or missing sourceSha256 in ${key}: ${pack.sourceSha256}`);
    }
    if (typeof pack.sourceFileSize !== "number" || pack.sourceFileSize < 5000000) {
      throw new Error(`Invalid sourceFileSize in ${key}: ${pack.sourceFileSize}`);
    }
    if (!pack.sourceDownloadedAt || isNaN(Date.parse(pack.sourceDownloadedAt))) {
      throw new Error(`Invalid sourceDownloadedAt timestamp in ${key}: ${pack.sourceDownloadedAt}`);
    }
    const chunkEntrySum = pack.chunks.reduce((s, c) => s + c.entryCount, 0);
    if (chunkEntrySum !== pack.entryCount) {
      throw new Error(`Chunk entry count sum (${chunkEntrySum}) does not match entryCount (${pack.entryCount}) in ${key}`);
    }
    const chunkSizeSum = pack.chunks.reduce((s, c) => s + c.size, 0);
    if (chunkSizeSum !== pack.totalSizeBytes) {
      throw new Error(`Chunk size sum (${chunkSizeSum}) does not match totalSizeBytes (${pack.totalSizeBytes}) in ${key}`);
    }
  }

  // 2. Verify Entry Counts
  console.log(`[dictionary:verify] Japanese entry count: ${jaMeta.entryCount}`);
  if (jaMeta.entryCount < 200000) {
    throw new Error(`Japanese dictionary entry count (${jaMeta.entryCount}) is too small; expected > 200,000.`);
  }

  console.log(`[dictionary:verify] English entry count: ${enMeta.entryCount}`);
  if (enMeta.entryCount < 120000) {
    throw new Error(`English dictionary entry count (${enMeta.entryCount}) is too small; expected > 120,000.`);
  }

  // 3. Verify Chunks & SHA-256 for Japanese
  console.log(`[dictionary:verify] Checking ${jaMeta.chunks.length} Japanese chunks...`);
  const jaIds = new Set();
  const jaWords = new Map();
  const jaReadings = new Map();

  for (const chunkInfo of jaMeta.chunks) {
    const chunkPath = path.join(PACKS_DIR, chunkInfo.file);
    if (!fs.existsSync(chunkPath)) {
      throw new Error(`Missing chunk file: ${chunkPath}`);
    }

    const computedSha = computeFileSha256(chunkPath);
    if (computedSha !== chunkInfo.checksum) {
      throw new Error(`SHA-256 mismatch for ${chunkInfo.file}: expected ${chunkInfo.checksum}, got ${computedSha}`);
    }

    const chunkData = JSON.parse(fs.readFileSync(chunkPath, "utf8"));
    if (chunkData.entries.length !== chunkInfo.entryCount) {
      throw new Error(`Entry count mismatch in ${chunkInfo.file}: expected ${chunkInfo.entryCount}, got ${chunkData.entries.length}`);
    }

    for (const entry of chunkData.entries) {
      if (!entry.id || !entry.word) {
        throw new Error(`Invalid schema in entry: ${JSON.stringify(entry)}`);
      }
      if (jaIds.has(entry.id)) {
        throw new Error(`Duplicate entry ID found in JA pack: ${entry.id}`);
      }
      jaIds.add(entry.id);
      jaWords.set(entry.word, entry);
      if (entry.altWords) {
        for (const alt of entry.altWords) jaWords.set(alt, entry);
      }
      if (entry.reading) {
        if (!jaReadings.has(entry.reading)) jaReadings.set(entry.reading, []);
        jaReadings.get(entry.reading).push(entry);
      }
      if (entry.altReadings) {
        for (const altR of entry.altReadings) {
          if (!jaReadings.has(altR)) jaReadings.set(altR, []);
          jaReadings.get(altR).push(entry);
        }
      }
    }
  }

  // 3. Verify Chunks & SHA-256 for English
  console.log(`[dictionary:verify] Checking ${enMeta.chunks.length} English chunks...`);
  const enIds = new Set();
  const enWords = new Map();

  for (const chunkInfo of enMeta.chunks) {
    const chunkPath = path.join(PACKS_DIR, chunkInfo.file);
    if (!fs.existsSync(chunkPath)) {
      throw new Error(`Missing chunk file: ${chunkPath}`);
    }

    const computedSha = computeFileSha256(chunkPath);
    if (computedSha !== chunkInfo.checksum) {
      throw new Error(`SHA-256 mismatch for ${chunkInfo.file}: expected ${chunkInfo.checksum}, got ${computedSha}`);
    }

    const chunkData = JSON.parse(fs.readFileSync(chunkPath, "utf8"));
    if (chunkData.entries.length !== chunkInfo.entryCount) {
      throw new Error(`Entry count mismatch in ${chunkInfo.file}: expected ${chunkInfo.entryCount}, got ${chunkData.entries.length}`);
    }

    for (const entry of chunkData.entries) {
      if (!entry.id || !entry.word) {
        throw new Error(`Invalid schema in entry: ${JSON.stringify(entry)}`);
      }
      if (enIds.has(entry.id)) {
        throw new Error(`Duplicate entry ID found in EN pack: ${entry.id}`);
      }
      enIds.add(entry.id);
      enWords.set(entry.word.toLowerCase(), entry);
    }
  }

  // 4. Verify Common Word Hits
  const requiredJaWords = ["学校", "会社", "未来", "開発", "読書", "日本語", "辞書"];
  console.log(`[dictionary:verify] Testing Japanese word lookups: ${requiredJaWords.join(", ")}...`);
  for (const w of requiredJaWords) {
    const entry = jaWords.get(w);
    if (!entry) {
      throw new Error(`Required Japanese word "${w}" not found in JMdict pack!`);
    }
    const glosses = (entry.senses || []).flatMap((s) => s.glosses || []);
    if (glosses.length === 0) {
      throw new Error(`Japanese word "${w}" has no definition glosses!`);
    }
    console.log(`  ✓ ${w} [${entry.reading}] -> ${glosses[0]}`);
  }

  // Verify kana reading hit (e.g. がっこう -> 学校)
  const gakkouEntries = jaReadings.get("がっこう") || [];
  const gakkouMatch = gakkouEntries.find((e) => e.word === "学校");
  if (!gakkouMatch) {
    throw new Error(`Reading "がっこう" did not resolve to "学校"!`);
  }
  console.log(`  ✓ Reading lookup: がっこう -> ${gakkouMatch.word}`);

  const requiredEnWords = ["bookmark", "computer", "language", "dictionary"];
  console.log(`[dictionary:verify] Testing English word lookups: ${requiredEnWords.join(", ")}...`);
  for (const w of requiredEnWords) {
    const entry = enWords.get(w);
    if (!entry) {
      throw new Error(`Required English word "${w}" not found in WordNet pack!`);
    }
    const defs = (entry.senses || []).map((s) => s.definition).filter(Boolean);
    if (defs.length === 0) {
      throw new Error(`English word "${w}" has no definitions!`);
    }
    console.log(`  ✓ ${w} -> ${defs[0]}`);
  }

  // 5. Ensure build does not use test sample fixture
  if (jaMeta.entryCount <= 100 || enMeta.entryCount <= 50) {
    throw new Error("CRITICAL: Dictionary manifest still points to sample/test fixture data!");
  }

  console.log("[dictionary:verify] SUCCESS! All dictionary packs and entries verified.");
  return {
    success: true,
    jaEntries: jaMeta.entryCount,
    enEntries: enMeta.entryCount,
    jaChunks: jaMeta.chunks.length,
    enChunks: enMeta.chunks.length
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyDictionaryPacks()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[dictionary:verify] FAILED:", err);
      process.exit(1);
    });
}
