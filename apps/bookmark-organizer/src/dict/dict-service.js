/**
 * High-level Dictionary Service (DICT-LOOKUP-001, DICT-SETTINGS-001, DICT-AI-001)
 *
 * Responsibilities:
 * - Settings & BYOK API key management (with strict boundary isolation).
 * - Multi-layer search orchestration (command parse -> language detect -> indexed lookup).
 * - Optional on-demand BYOK AI context explanations (with local caching).
 */

import {
  DEFAULT_DICT_SETTINGS,
  DICT_SETTINGS_STORAGE_KEY,
  DICT_AI_KEY_STORAGE_KEY
} from "./dict-constants.js";
import { parseDictCommand, detectLanguage } from "./lang-detector.js";
import {
  lookupWord,
  getInstalledPacks,
  installPack,
  installPackFromChunks,
  uninstallPack,
  getAiCache,
  setAiCache,
  clearAiCache,
  addHistory,
  clearHistory,
  computeStringSha256
} from "./dict-db.js";

const memoryStorage = new Map();

/**
 * Storage helpers supporting chrome.storage.local, localStorage, or in-memory fallback
 */
async function getStorageItem(key) {
  if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
    try {
      const res = await chrome.storage.local.get(key);
      return res?.[key];
    } catch {}
  }
  try {
    if (typeof localStorage !== "undefined") {
      const item = localStorage.getItem(key);
      if (item !== null && item !== undefined) return JSON.parse(item);
    }
  } catch {}
  return memoryStorage.get(key);
}

async function setStorageItem(key, value) {
  if (typeof chrome !== "undefined" && chrome.storage?.local?.set) {
    try {
      await chrome.storage.local.set({ [key]: value });
      return;
    } catch {}
  }
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, JSON.stringify(value));
      return;
    }
  } catch {}
  memoryStorage.set(key, value);
}

/**
 * Get current dictionary settings.
 */
export async function getDictSettings() {
  const stored = await getStorageItem(DICT_SETTINGS_STORAGE_KEY);
  if (!stored || typeof stored !== "object") {
    return { ...DEFAULT_DICT_SETTINGS };
  }
  return {
    ...DEFAULT_DICT_SETTINGS,
    ...stored,
    installedPacks: {
      ...DEFAULT_DICT_SETTINGS.installedPacks,
      ...(stored.installedPacks || {})
    }
  };
}

/**
 * Save dictionary settings.
 */
export async function saveDictSettings(patch) {
  const current = await getDictSettings();
  const updated = {
    ...current,
    ...patch,
    installedPacks: {
      ...current.installedPacks,
      ...(patch.installedPacks || {})
    }
  };
  await setStorageItem(DICT_SETTINGS_STORAGE_KEY, updated);
  return updated;
}

/**
 * BYOK AI Key accessors (strictly segregated from general settings).
 */
export async function getAiApiKey() {
  return (await getStorageItem(DICT_AI_KEY_STORAGE_KEY)) || "";
}

export async function getAiApiKeyStatus() {
  const key = await getAiApiKey();
  return { hasKey: Boolean(key) };
}

export async function saveAiApiKey(key) {
  await setStorageItem(DICT_AI_KEY_STORAGE_KEY, (key || "").trim());
  return true;
}

/**
 * Execute dictionary search.
 */
export async function searchDictionary(rawQuery, { context = "", htmlLang = "" } = {}) {
  const settings = await getDictSettings();

  // 1. If dictionary is disabled, return early
  if (!settings.enabled) {
    return {
      isEnabled: false,
      query: rawQuery,
      entries: [],
      message: "Dictionary module is currently disabled. Enable it in Settings → Dictionary."
    };
  }

  // 2. Parse command prefix (e.g. "dict ja <word>", "dict en <word>", "辞書 <word>")
  const cmd = parseDictCommand(rawQuery);
  const targetWord = cmd.query;
  if (!targetWord) {
    return { isEnabled: true, query: "", entries: [], message: "" };
  }

  // 3. Language detection
  const detection = detectLanguage(targetWord, {
    context,
    htmlLang,
    explicitLang: cmd.explicitLang || (settings.defaultSourceLang !== "auto" ? settings.defaultSourceLang : null)
  });

  // 4. Handle unsupported languages (e.g. Chinese)
  if (!detection.supported) {
    return {
      isEnabled: true,
      query: targetWord,
      detectedLang: detection.lang,
      supported: false,
      entries: [],
      message: detection.message || "This language is not supported in the offline dictionary."
    };
  }

  const lang = detection.lang;
  const installedPacks = await getInstalledPacks();
  const packForLang = installedPacks.find((p) => p.language === lang);

  // 5. If pack is not installed, prompt user to install it
  if (!packForLang) {
    const langName = lang === "ja" ? "Japanese (JMdict)" : "English (WordNet)";
    return {
      isEnabled: true,
      query: targetWord,
      detectedLang: lang,
      supported: true,
      packInstalled: false,
      entries: [],
      message: `The ${langName} dictionary pack is not installed yet. You can install it from Settings → Dictionary.`
    };
  }

  // 6. Point lookup in IndexedDB
  const matches = await lookupWord(targetWord, { lang, limit: 10 });

  // Record lookup history
  if (matches.length > 0) {
    addHistory(targetWord, lang).catch(() => {});
  }

  return {
    isEnabled: true,
    query: targetWord,
    detectedLang: lang,
    ambiguous: detection.ambiguous,
    supported: true,
    packInstalled: true,
    packInfo: {
      packId: packForLang.packId,
      name: packForLang.name,
      source: packForLang.source,
      license: packForLang.license,
      attribution: packForLang.attribution
    },
    entries: matches
  };
}

/**
 * On-demand BYOK AI Context Explanation (DICT-AI-001)
 * Strictly bounded: sends only target word, language, max 1 surrounding sentence, and dictionary glosses.
 */
export async function explainWithAi({
  word,
  language,
  contextSentence = "",
  definitions = []
}) {
  const settings = await getDictSettings();
  if (!settings.enabled || !settings.aiEnabled) {
    throw new Error("AI context explanation is disabled in Dictionary Settings.");
  }

  const apiKey = await getAiApiKey();
  if (!apiKey) {
    throw new Error("No API key configured. Please enter your API key in Settings → Dictionary.");
  }

  const boundedSentence = (contextSentence || "").trim().slice(0, 300);
  const cachePayload = `${settings.aiProvider}_${word}_${boundedSentence}`;
  const cacheKey = await computeStringSha256(cachePayload);

  // Check local cache first
  const cached = await getAiCache(cacheKey);
  if (cached) {
    return { text: cached, cached: true, provider: settings.aiProvider };
  }

  const prompt = [
    `You are a concise linguistic dictionary assistant.`,
    `Explain the meaning, nuance, and contextual usage of the word "${word}" in the given context.`,
    `Language: ${language}`,
    boundedSentence ? `Surrounding sentence: "${boundedSentence}"` : "",
    definitions.length > 0 ? `Dictionary definitions: ${definitions.join("; ")}` : "",
    `Keep your explanation concise (2 to 3 sentences maximum), focusing on the exact contextual meaning.`
  ].filter(Boolean).join("\n");

  let explanationText = "";

  if (settings.aiProvider === "gemini") {
    const model = settings.aiModel || "gemini-1.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 250, temperature: 0.2 }
      })
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Gemini API error (${res.status}): ${errBody.slice(0, 150)}`);
    }
    const data = await res.json();
    explanationText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "No explanation returned.";
  } else {
    // OpenAI fallback
    const model = settings.aiModel || "gpt-4o-mini";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a concise linguistic dictionary assistant." },
          { role: "user", content: prompt }
        ],
        max_tokens: 250,
        temperature: 0.2
      })
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`OpenAI API error (${res.status}): ${errBody.slice(0, 150)}`);
    }
    const data = await res.json();
    explanationText = data.choices?.[0]?.message?.content?.trim() || "No explanation returned.";
  }

  // Save to local cache
  await setAiCache(cacheKey, explanationText);
  return { text: explanationText, cached: false, provider: settings.aiProvider };
}

export {
  installPack,
  installPackFromChunks,
  uninstallPack,
  getInstalledPacks,
  clearAiCache,
  clearHistory
};
