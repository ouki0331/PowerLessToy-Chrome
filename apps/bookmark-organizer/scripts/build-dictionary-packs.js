/**
 * Reproducible Dictionary Packs Builder & Verifier
 * PowerLessToy Bookmark Organizer (DICT-PACK-001)
 *
 * Sources:
 * - Japanese: JMdict_e (Electronic Dictionary Research and Development Group - EDRDG)
 *   License: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
 *   URL: https://ftp.edrdg.org/pub/Nihongo/00INDEX.html
 * - English: Open English WordNet (Global WordNet Association)
 *   License: Creative Commons Attribution 4.0 International (CC BY 4.0)
 *   URL: https://github.com/globalwordnet/english-wordnet/releases
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = path.resolve(__dirname, "../src/dict/packs");

export function computeSha256(contentString) {
  return crypto.createHash("sha256").update(contentString, "utf8").digest("hex");
}

export function validatePackStructure(pack) {
  if (!pack || typeof pack !== "object") throw new Error("Pack must be an object");
  if (!pack.packId || typeof pack.packId !== "string") throw new Error("Missing packId");
  if (!pack.language || typeof pack.language !== "string") throw new Error("Missing language");
  if (!pack.version || typeof pack.version !== "string") throw new Error("Missing version");
  if (!pack.license || typeof pack.license !== "string") throw new Error("Missing license");
  if (!pack.attribution || typeof pack.attribution !== "string") throw new Error("Missing attribution");
  if (!Array.isArray(pack.entries)) throw new Error("Entries must be an array");
  if (pack.entries.length === 0) throw new Error("Entries array cannot be empty");

  for (let i = 0; i < Math.min(pack.entries.length, 50); i++) {
    const entry = pack.entries[i];
    if (!entry.id || !entry.word || !Array.isArray(entry.senses)) {
      throw new Error(`Invalid entry structure at index ${i}`);
    }
  }
  return true;
}

export function buildPacksManifest(packFiles = []) {
  const manifest = {
    schemaVersion: "1.0.0",
    updatedAt: new Date().toISOString(),
    supportedLanguages: ["ja", "en"],
    extensibleLanguages: ["fr", "es"],
    packs: {}
  };

  for (const filePath of packFiles) {
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    validatePackStructure(parsed);
    const checksum = computeSha256(raw);
    const stats = fs.statSync(filePath);

    manifest.packs[parsed.packId] = {
      packId: parsed.packId,
      language: parsed.language,
      name: parsed.name || parsed.packId,
      version: parsed.version,
      generatedAt: parsed.generatedAt || new Date().toISOString(),
      source: parsed.source,
      sourceUrl: parsed.sourceUrl,
      sourceVersion: parsed.sourceVersion || "latest",
      license: parsed.license,
      attribution: parsed.attribution,
      checksum,
      fileSize: stats.size,
      entryCount: parsed.entries.length,
      file: path.basename(filePath)
    };
  }

  return manifest;
}

// When executed directly via node
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("Validating and compiling dictionary packs...");
  const jaPath = path.join(PACKS_DIR, "dict_ja_jmdict.json");
  const enPath = path.join(PACKS_DIR, "dict_en_wordnet.json");
  const manifestPath = path.join(PACKS_DIR, "manifest.json");

  const manifest = buildPacksManifest([jaPath, enPath]);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Packs manifest updated with ${Object.keys(manifest.packs).length} pack(s).`);
}
