/**
 * Dictionary Fetch Script (Official Data Download)
 *
 * Security & Supply Chain Hardening:
 * 1. Strict HTTPS only: No HTTP fallback, no insecure redirects.
 * 2. Node default TLS verification: No rejectUnauthorized: false.
 * 3. Atomic download pattern: Download to .part file, verify, and atomic rename.
 * 4. Error isolation: Incomplete or aborted downloads clean up .part file immediately.
 * 5. Content-Length & byte integrity checks.
 * 6. Never uses dummy seed data.
 *
 * Sources:
 * - Japanese: https://www.edrdg.org/pub/Nihongo/JMdict_e.gz (EDRDG official HTTPS)
 * - English: https://en-word.net/static/english-wordnet-2025-json.zip (OEWN official HTTPS)
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CACHE_DIR = path.resolve(__dirname, "../.cache/dictionary");

export const OFFICIAL_SOURCES = {
  ja: {
    name: "JMdict_e",
    url: "https://www.edrdg.org/pub/Nihongo/JMdict_e.gz",
    fileName: "JMdict_e.gz",
    source: "Electronic Dictionary Research and Development Group (EDRDG)",
    sourceUrl: "https://www.edrdg.org/pub/Nihongo/00INDEX.html",
    license: "CC BY-SA 4.0",
    attribution: "This work uses the JMdict dictionary file, property of the Electronic Dictionary Research and Development Group, used in accordance with the Creative Commons Attribution-ShareAlike 4.0 International license."
  },
  en: {
    name: "Open English WordNet 2025",
    url: "https://en-word.net/static/english-wordnet-2025-json.zip",
    fileName: "english-wordnet-2025-json.zip",
    source: "Global WordNet Association / Open English WordNet",
    sourceUrl: "https://en-word.net/",
    license: "CC BY 4.0",
    attribution: "Open English WordNet is distributed under the Creative Commons Attribution 4.0 International license."
  }
};

export function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Download a file strictly over HTTPS with redirect limit, .part staging, and Content-Length verification.
 */
export function downloadHttpsFile(targetUrl, destPath, { maxRedirects = 5, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const partPath = `${destPath}.part`;

    function cleanupPart() {
      try {
        if (fs.existsSync(partPath)) {
          fs.unlinkSync(partPath);
        }
      } catch {}
    }

    let redirectCount = 0;

    function attempt(currentUrl) {
      // 1. Strict HTTPS Check
      if (!currentUrl.startsWith("https://")) {
        cleanupPart();
        return reject(new Error(`Insecure protocol rejected: "${currentUrl}". Only HTTPS is allowed.`));
      }

      console.log(`[dictionary:fetch] HTTPS GET: ${currentUrl}`);

      const req = https.get(currentUrl, {
        headers: {
          "User-Agent": "PowerLessToy-DictionaryFetcher/1.0"
        }
      }, (res) => {
        // 2. Handle HTTP Redirects (301, 302, 303, 307, 308)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          redirectCount++;
          if (redirectCount > maxRedirects) {
            cleanupPart();
            res.resume();
            return reject(new Error(`Too many redirects (limit: ${maxRedirects}) for ${targetUrl}`));
          }

          const redirectUrl = new URL(res.headers.location, currentUrl).toString();
          if (!redirectUrl.startsWith("https://")) {
            cleanupPart();
            res.resume();
            return reject(new Error(`Insecure redirect to HTTP rejected: ${redirectUrl}`));
          }

          console.log(`[dictionary:fetch] Redirecting (${redirectCount}/${maxRedirects}) -> ${redirectUrl}`);
          res.resume();
          return attempt(redirectUrl);
        }

        if (res.statusCode !== 200) {
          cleanupPart();
          res.resume();
          return reject(new Error(`Failed to download ${currentUrl}: HTTP ${res.statusCode}`));
        }

        const expectedLength = parseInt(res.headers["content-length"] || "0", 10);
        let downloadedBytes = 0;
        let lastReport = Date.now();

        const fileStream = fs.createWriteStream(partPath);
        res.on("data", (chunk) => {
          downloadedBytes += chunk.length;
          const now = Date.now();
          if (now - lastReport > 2000) {
            lastReport = now;
            const pct = expectedLength > 0 ? ` (${((downloadedBytes / expectedLength) * 100).toFixed(1)}%)` : "";
            console.log(`[dictionary:fetch] Received ${(downloadedBytes / 1024 / 1024).toFixed(2)} MB${pct}`);
          }
        });

        res.pipe(fileStream);

        fileStream.on("finish", async () => {
          fileStream.close(async () => {
            // Verify Content-Length if specified
            if (expectedLength > 0 && downloadedBytes !== expectedLength) {
              cleanupPart();
              return reject(new Error(`Content-Length mismatch: expected ${expectedLength} bytes, received ${downloadedBytes} bytes`));
            }

            try {
              // Atomic rename from .part to destPath
              fs.renameSync(partPath, destPath);
              console.log(`[dictionary:fetch] Verified and saved: ${destPath} (${(downloadedBytes / 1024 / 1024).toFixed(2)} MB)`);
              resolve();
            } catch (renameErr) {
              cleanupPart();
              reject(renameErr);
            }
          });
        });

        fileStream.on("error", (err) => {
          cleanupPart();
          reject(err);
        });
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Download timed out after ${timeoutMs}ms for ${currentUrl}`));
      });

      req.on("error", (err) => {
        cleanupPart();
        reject(err);
      });
    }

    attempt(targetUrl);
  });
}

export async function fetchDictionaryData({ cacheDir = DEFAULT_CACHE_DIR, force = false } = {}) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const metaFile = path.join(cacheDir, "fetch-meta.json");

  const meta = fs.existsSync(metaFile)
    ? JSON.parse(fs.readFileSync(metaFile, "utf8"))
    : {};

  for (const [langKey, info] of Object.entries(OFFICIAL_SOURCES)) {
    const destPath = path.join(cacheDir, info.fileName);
    const fileExists = fs.existsSync(destPath);
    const existingSize = fileExists ? fs.statSync(destPath).size : 0;

    if (!force && fileExists && existingSize > 5000000) {
      console.log(`[dictionary:fetch] Found existing valid cache for ${info.name}: ${destPath} (${(existingSize / 1024 / 1024).toFixed(2)} MB)`);
      const sha = await computeFileSha256(destPath);
      meta[langKey] = {
        ...info,
        fileSize: existingSize,
        sha256: sha,
        downloadedAt: meta[langKey]?.downloadedAt || new Date().toISOString()
      };
      continue;
    }

    console.log(`[dictionary:fetch] Downloading official data strictly via HTTPS for ${info.name}...`);
    await downloadHttpsFile(info.url, destPath);

    const fileSize = fs.statSync(destPath).size;
    const sha = await computeFileSha256(destPath);
    console.log(`[dictionary:fetch] Completed ${info.name}: SHA-256=${sha}, size=${fileSize} bytes`);

    meta[langKey] = {
      ...info,
      fileSize,
      sha256: sha,
      downloadedAt: new Date().toISOString()
    };
  }

  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), "utf8");
  console.log(`[dictionary:fetch] Updated fetch metadata at ${metaFile}`);
  return meta;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const force = process.argv.includes("--force");
  fetchDictionaryData({ force })
    .then(() => {
      console.log("[dictionary:fetch] SUCCESS: Official dictionary files ready.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[dictionary:fetch] FAILED:", err.message);
      process.exit(1);
    });
}
