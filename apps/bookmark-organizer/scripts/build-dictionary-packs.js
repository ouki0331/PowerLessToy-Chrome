/**
 * Dictionary Pack Builder (Official JMdict and Open English WordNet)
 *
 * Responsibilities:
 * 1. Stream-parse official JMdict_e.gz XML without loading entire file in memory.
 * 2. Parse Open English WordNet 2025 synsets and lemmas.
 * 3. Convert both to unified dictionary schema:
 *    { id, word, reading, pos, senses: [{ definition, glosses, synonyms, examples }], common }
 * 4. Split entries into manageable chunks (~10,000 entries each, ~1.8MB - ~2.7MB per chunk).
 * 5. Compute SHA-256 checksums on the raw serialized file bytes.
 * 6. Generate production manifest.json with chunk metadata.
 * 7. Strictly avoids sample/seed dummy data.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.resolve(__dirname, "../.cache/dictionary");
const PACKS_DIR = path.resolve(__dirname, "../src/dict/packs");
const CHUNKS_DIR = path.resolve(PACKS_DIR, "chunks");

const CHUNK_SIZE = 10000;

function computeFileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

/**
 * 1. Build Japanese JMdict Pack from JMdict_e.gz
 */
async function buildJapanesePack() {
  const gzPath = path.join(CACHE_DIR, "JMdict_e.gz");
  if (!fs.existsSync(gzPath)) {
    throw new Error(`JMdict archive not found at ${gzPath}. Run npm run dictionary:fetch first.`);
  }

  console.log(`[dictionary:build] Streaming JMdict XML from ${gzPath}...`);
  const gunzip = zlib.createGunzip();
  const fileStream = fs.createReadStream(gzPath);
  fileStream.pipe(gunzip);

  const rl = readline.createInterface({
    input: gunzip,
    crlfDelay: Infinity
  });

  let totalEntries = 0;
  let chunkIndex = 1;
  let currentChunkEntries = [];
  const chunkMetas = [];

  let inEntry = false;
  let currentEntry = null;
  let currentSense = null;

  function flushChunk() {
    if (currentChunkEntries.length === 0) return;
    const chunkFileName = `ja_jmdict_chunk_${String(chunkIndex).padStart(3, "0")}.json`;
    const chunkFilePath = path.join(CHUNKS_DIR, chunkFileName);
    const chunkData = {
      packId: "ja_jmdict",
      language: "ja",
      chunkIndex,
      entryCount: currentChunkEntries.length,
      entries: currentChunkEntries
    };

    const rawJson = JSON.stringify(chunkData);
    fs.writeFileSync(chunkFilePath, rawJson, "utf8");

    const checksum = crypto.createHash("sha256").update(rawJson, "utf8").digest("hex");
    const size = Buffer.byteLength(rawJson, "utf8");

    chunkMetas.push({
      file: `chunks/${chunkFileName}`,
      entryCount: currentChunkEntries.length,
      size,
      checksum
    });

    console.log(`[dictionary:build] Written JA chunk ${chunkIndex}: ${chunkFileName} (${currentChunkEntries.length} entries, ${(size / 1024 / 1024).toFixed(2)} MB)`);
    chunkIndex++;
    currentChunkEntries = [];
  }

  for await (const rawLine of rl) {
    const line = rawLine.trim();

    if (line === "<entry>") {
      inEntry = true;
      currentEntry = {
        id: "",
        word: "",
        reading: "",
        altWords: [],
        altReadings: [],
        pos: [],
        senses: [],
        common: false
      };
      currentSense = null;
      continue;
    }

    if (line === "</entry>") {
      inEntry = false;
      if (currentEntry) {
        if (!currentEntry.word && currentEntry.reading) {
          currentEntry.word = currentEntry.reading;
        }
        if (currentEntry.word) {
          currentChunkEntries.push(currentEntry);
          totalEntries++;
          if (currentChunkEntries.length >= CHUNK_SIZE) {
            flushChunk();
          }
        }
      }
      currentEntry = null;
      currentSense = null;
      continue;
    }

    if (!inEntry || !currentEntry) continue;

    if (line.startsWith("<ent_seq>")) {
      currentEntry.id = "jmdict_" + line.replace(/<\/?ent_seq>/g, "");
    } else if (line.startsWith("<keb>")) {
      const k = line.replace(/<\/?keb>/g, "");
      if (!currentEntry.word) currentEntry.word = k;
      else if (!currentEntry.altWords.includes(k)) currentEntry.altWords.push(k);
    } else if (line.startsWith("<ke_pri>") || line.startsWith("<re_pri>")) {
      currentEntry.common = true;
    } else if (line.startsWith("<reb>")) {
      const r = line.replace(/<\/?reb>/g, "");
      if (!currentEntry.reading) currentEntry.reading = r;
      else if (!currentEntry.altReadings.includes(r)) currentEntry.altReadings.push(r);
    } else if (line.startsWith("<sense>")) {
      currentSense = { glosses: [] };
      currentEntry.senses.push(currentSense);
    } else if (line.startsWith("<pos>")) {
      const p = line.replace(/<\/?pos>/g, "").replace(/&|;/g, "").trim();
      if (p && !currentEntry.pos.includes(p)) currentEntry.pos.push(p);
    } else if (line.startsWith("<gloss>")) {
      const g = line.replace(/<gloss[^>]*>/, "").replace(/<\/gloss>/, "").trim();
      if (g && currentSense) currentSense.glosses.push(g);
    }
  }

  // Flush remaining entries
  flushChunk();

  console.log(`[dictionary:build] Completed JMdict: ${totalEntries} entries across ${chunkMetas.length} chunks.`);
  return {
    packId: "ja_jmdict",
    language: "ja",
    name: "JMdict (Japanese-English)",
    version: "2026.11.10",
    source: "Electronic Dictionary Research and Development Group (EDRDG)",
    sourceUrl: "https://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz",
    sourceVersion: "JMdict_e Rev 1.09",
    license: "CC BY-SA 4.0",
    attribution: "This work uses the JMdict dictionary file, property of the Electronic Dictionary Research and Development Group, used in accordance with the Creative Commons Attribution-ShareAlike 4.0 International license.",
    entryCount: totalEntries,
    chunkCount: chunkMetas.length,
    chunks: chunkMetas
  };
}

/**
 * 2. Build English WordNet Pack from Open English WordNet 2025
 */
async function buildEnglishPack() {
  const zipPath = path.join(CACHE_DIR, "english-wordnet-2025-json.zip");
  if (!fs.existsSync(zipPath)) {
    throw new Error(`WordNet archive not found at ${zipPath}. Run npm run dictionary:fetch first.`);
  }

  const extractDir = path.join(CACHE_DIR, "oewn_extracted");
  if (!fs.existsSync(extractDir) || fs.readdirSync(extractDir).length === 0) {
    console.log(`[dictionary:build] Extracting WordNet zip to ${extractDir}...`);
    fs.mkdirSync(extractDir, { recursive: true });
    execSync(`unzip -q -o "${zipPath}" -d "${extractDir}"`);
  }

  console.log(`[dictionary:build] Loading synset definitions into memory...`);
  const synsetMap = new Map();
  const files = fs.readdirSync(extractDir);

  for (const f of files) {
    if ((f.startsWith("noun.") || f.startsWith("verb.") || f.startsWith("adj.") || f.startsWith("adv.")) && f.endsWith(".json")) {
      const raw = fs.readFileSync(path.join(extractDir, f), "utf8");
      const synData = JSON.parse(raw);
      for (const [id, s] of Object.entries(synData)) {
        synsetMap.set(id, {
          def: s.definition?.[0] || "",
          pos: s.partOfSpeech || "",
          members: s.members || [],
          examples: s.example || []
        });
      }
    }
  }
  console.log(`[dictionary:build] Loaded ${synsetMap.size} synset definitions.`);

  let totalEntries = 0;
  let chunkIndex = 1;
  let currentChunkEntries = [];
  const chunkMetas = [];

  function flushChunk() {
    if (currentChunkEntries.length === 0) return;
    const chunkFileName = `en_wordnet_chunk_${String(chunkIndex).padStart(3, "0")}.json`;
    const chunkFilePath = path.join(CHUNKS_DIR, chunkFileName);
    const chunkData = {
      packId: "en_wordnet",
      language: "en",
      chunkIndex,
      entryCount: currentChunkEntries.length,
      entries: currentChunkEntries
    };

    const rawJson = JSON.stringify(chunkData);
    fs.writeFileSync(chunkFilePath, rawJson, "utf8");

    const checksum = crypto.createHash("sha256").update(rawJson, "utf8").digest("hex");
    const size = Buffer.byteLength(rawJson, "utf8");

    chunkMetas.push({
      file: `chunks/${chunkFileName}`,
      entryCount: currentChunkEntries.length,
      size,
      checksum
    });

    console.log(`[dictionary:build] Written EN chunk ${chunkIndex}: ${chunkFileName} (${currentChunkEntries.length} entries, ${(size / 1024 / 1024).toFixed(2)} MB)`);
    chunkIndex++;
    currentChunkEntries = [];
  }

  const entryFiles = files.filter((f) => f.startsWith("entries-") && f.endsWith(".json")).sort();
  for (const ef of entryFiles) {
    const raw = fs.readFileSync(path.join(extractDir, ef), "utf8");
    const data = JSON.parse(raw);

    for (const [word, posMap] of Object.entries(data)) {
      const poses = Object.keys(posMap);
      const senses = [];
      let reading = "";

      for (const p of poses) {
        const pData = posMap[p];
        if (pData.pronunciation?.[0]?.value && !reading) {
          reading = pData.pronunciation[0].value;
        }
        for (const s of (pData.sense || [])) {
          const syn = synsetMap.get(s.synset);
          if (syn) {
            senses.push({
              definition: syn.def,
              synonyms: syn.members.filter((m) => m !== word),
              examples: syn.examples
            });
          }
        }
      }

      totalEntries++;
      currentChunkEntries.push({
        id: "oewn_" + String(totalEntries).padStart(7, "0"),
        word,
        reading,
        pos: poses,
        senses,
        common: senses.length > 2
      });

      if (currentChunkEntries.length >= CHUNK_SIZE) {
        flushChunk();
      }
    }
  }

  flushChunk();

  console.log(`[dictionary:build] Completed Open English WordNet: ${totalEntries} entries across ${chunkMetas.length} chunks.`);
  return {
    packId: "en_wordnet",
    language: "en",
    name: "Open English WordNet",
    version: "2025.1",
    source: "Global WordNet Association / Open English WordNet",
    sourceUrl: "https://en-word.net/static/english-wordnet-2025-json.zip",
    sourceVersion: "2025-edition",
    license: "CC BY 4.0",
    attribution: "Open English WordNet is distributed under the Creative Commons Attribution 4.0 International license.",
    entryCount: totalEntries,
    chunkCount: chunkMetas.length,
    chunks: chunkMetas
  };
}

export async function buildDictionaryPacks() {
  fs.mkdirSync(CHUNKS_DIR, { recursive: true });

  console.log("[dictionary:build] Starting dictionary build from official upstream archives...");
  const jaMeta = await buildJapanesePack();
  const enMeta = await buildEnglishPack();

  const manifest = {
    schemaVersion: "2.0.0",
    generatedAt: new Date().toISOString(),
    supportedLanguages: ["ja", "en"],
    extensibleLanguages: ["fr", "es"],
    packs: {
      ja_jmdict: jaMeta,
      en_wordnet: enMeta
    }
  };

  const manifestPath = path.join(PACKS_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`[dictionary:build] Generated production manifest at ${manifestPath}`);

  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildDictionaryPacks()
    .then((manifest) => {
      console.log(`[dictionary:build] SUCCESS! JA entries: ${manifest.packs.ja_jmdict.entryCount}, EN entries: ${manifest.packs.en_wordnet.entryCount}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[dictionary:build] FAILED:", err);
      process.exit(1);
    });
}
