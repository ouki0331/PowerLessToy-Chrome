/**
 * Integration Test for Official Dictionary Upstream Fetch
 *
 * Verifies live connectivity, TLS certificates, and headers of official sources:
 * - JMdict (EDRDG): https://www.edrdg.org/pub/Nihongo/JMdict_e.gz
 * - Open English WordNet: https://en-word.net/static/english-wordnet-2025-json.zip
 *
 * Note: This script requires internet connectivity and is decoupled from standard
 * offline unit tests (`npm test`).
 */

import https from "node:https";
import { OFFICIAL_SOURCES } from "./fetch-dictionary-data.js";

function checkHttpsEndpoint(urlStr, { maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let redirectCount = 0;

    function attempt(currentUrl) {
      if (!currentUrl.startsWith("https://")) {
        return reject(new Error(`Insecure protocol: ${currentUrl}. Only HTTPS allowed.`));
      }

      const req = https.request(
        currentUrl,
        {
          method: "HEAD",
          headers: {
            "User-Agent": "BookmarkOrganizer/0.4.0 (IntegrationTest; Node.js)"
          },
          timeout: 15000
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            redirectCount++;
            if (redirectCount > maxRedirects) {
              return reject(new Error(`Too many redirects (>${maxRedirects}) from ${urlStr}`));
            }
            const nextUrl = new URL(res.headers.location, currentUrl).href;
            return attempt(nextUrl);
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              url: currentUrl,
              statusCode: res.statusCode,
              contentLength: res.headers["content-length"] ? parseInt(res.headers["content-length"], 10) : null,
              contentType: res.headers["content-type"] || ""
            });
          } else {
            reject(new Error(`HTTP status ${res.statusCode} from ${currentUrl}`));
          }
        }
      );

      req.on("timeout", () => {
        req.destroy(new Error(`Timeout connecting to ${currentUrl}`));
      });

      req.on("error", (err) => {
        reject(err);
      });

      req.end();
    }

    attempt(urlStr);
  });
}

async function run() {
  console.log("[dictionary:test-fetch] Testing official HTTPS endpoints...");

  for (const [lang, info] of Object.entries(OFFICIAL_SOURCES)) {
    process.stdout.write(`  Checking ${lang.toUpperCase()} (${info.name}): ${info.url} ... `);
    try {
      const res = await checkHttpsEndpoint(info.url);
      console.log(`OK (Status: ${res.statusCode}, Size: ${res.contentLength || "unknown"} bytes, Type: ${res.contentType})`);
    } catch (err) {
      console.error(`FAILED: ${err.message}`);
      process.exitCode = 1;
    }
  }

  if (process.exitCode) {
    console.error("[dictionary:test-fetch] Integration check FAILED.");
    process.exit(1);
  } else {
    console.log("[dictionary:test-fetch] All official HTTPS endpoints verified successfully.");
  }
}

run();
