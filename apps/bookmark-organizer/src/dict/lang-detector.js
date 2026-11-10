/**
 * Multi-layer Language Detection for Dictionary Lookups (DICT-LANG-001)
 *
 * Priority order:
 * 1. Command prefix / user explicit override (dict ja, dict en, 辞書)
 * 2. Script features: Kana -> Japanese (ja), Latin -> English (en)
 * 3. HTML lang attribute (ja / zh)
 * 4. Context sentenceKana / distinctive markers
 * 5. Distinctive Simplified Chinese-only characters (never present in Japanese Jouyou/Jinmeiyo Kanji)
 * 6. Pure Kanji without Kana: flagged as ambiguous, defaults to Japanese (ja) to attempt lookup
 *
 * Requirements:
 * - Common Japanese words like 学校, 会社, 未来, 開発, 読書, 日本語, 辞書 must NOT be rejected as Chinese.
 * - AI does NOT perform base language detection.
 * - Chinese is NOT supported: when reliably detected, return supported: false with clear reason.
 */

// Distinctive characters exclusive to Simplified Chinese that are NEVER valid modern Japanese Jouyou or Jinmeiyo kanji.
// Caution: Never include shared characters like 学, 会, 来, 机, 典, 点, 写, etc.
const EXCLUSIVE_SIMPLIFIED_CHINESE_MARKERS = new Set([
  // Grammar words / particles exclusive to Chinese
  "们", "这", "哪", "么", "谁", "样", "吗", "吧", "呢", "咱", "俩",
  // Unique simplified Hanzi glyphs (Japanese uses traditional or distinct Shinjitai forms)
  "经", "产", "变", "认", "识", "说", "请", "读", "话", "词", "语", "译",
  "门", "见", "观", "规", "买", "卖", "车", "东", "开", "关", "头", "问",
  "为", "动", "电", "发", "汉", "给", "从"
]);

const KANA_REGEX = /[\u3040-\u309F\u30A0-\u30FF]/;
const KANJI_REGEX = /[\u4E00-\u9FFF]/;
const LATIN_REGEX = /[a-zA-Z]/;

export function parseDictCommand(rawInput) {
  const input = (rawInput || "").trim();
  if (!input) {
    return { isCommand: false, query: "", explicitLang: null };
  }

  // 1. "dict ja <word>" or "dict:ja <word>"
  const jaMatch = input.match(/^(?:dict[\s:]+ja)\s+(.+)$/i);
  if (jaMatch) {
    return { isCommand: true, query: jaMatch[1].trim(), explicitLang: "ja" };
  }

  // 2. "dict en <word>" or "dict:en <word>"
  const enMatch = input.match(/^(?:dict[\s:]+en)\s+(.+)$/i);
  if (enMatch) {
    return { isCommand: true, query: enMatch[1].trim(), explicitLang: "en" };
  }

  // 3. "辞書 <word>" or "辞書: <word>"
  const jishoMatch = input.match(/^(?:辞書|辞书)[\s:]*(.+)$/);
  if (jishoMatch) {
    return { isCommand: true, query: jishoMatch[1].trim(), explicitLang: "ja" };
  }

  // 4. "dict <word>" or "dict: <word>"
  const genericMatch = input.match(/^dict[\s:]+(.+)$/i);
  if (genericMatch) {
    return { isCommand: true, query: genericMatch[1].trim(), explicitLang: null };
  }

  return { isCommand: false, query: input, explicitLang: null };
}

export function detectLanguage(word, { context = "", htmlLang = "", explicitLang = null } = {}) {
  const target = (word || "").trim();
  if (!target) {
    return { lang: "en", supported: true, ambiguous: false, source: "default" };
  }

  // 1. Explicit user specification
  if (explicitLang === "ja" || explicitLang === "en") {
    return { lang: explicitLang, supported: true, ambiguous: false, source: "explicit" };
  }

  // 2. Script feature: Japanese Kana presence (Hiragana or Katakana)
  if (KANA_REGEX.test(target)) {
    return { lang: "ja", supported: true, ambiguous: false, source: "kana" };
  }

  // 3. Script feature: Pure Latin characters
  if (LATIN_REGEX.test(target) && !KANJI_REGEX.test(target)) {
    return { lang: "en", supported: true, ambiguous: false, source: "latin" };
  }

  // 4. Script feature: CJK ideographs / Kanji without Kana
  if (KANJI_REGEX.test(target)) {
    // 4a. Check HTML language tag if provided
    if (htmlLang) {
      const lower = htmlLang.toLowerCase();
      if (lower.startsWith("zh")) {
        return {
          lang: "zh",
          supported: false,
          ambiguous: false,
          source: "html_lang_zh",
          message: "Chinese language is not supported in offline dictionary."
        };
      }
      if (lower.startsWith("ja")) {
        return { lang: "ja", supported: true, ambiguous: false, source: "html_lang_ja" };
      }
    }

    // 4b. Check surrounding context for Japanese Kana
    if (context && KANA_REGEX.test(context)) {
      return { lang: "ja", supported: true, ambiguous: false, source: "context_kana" };
    }

    // 4c. Check for characters exclusive to Simplified Chinese in target
    for (const char of target) {
      if (EXCLUSIVE_SIMPLIFIED_CHINESE_MARKERS.has(char)) {
        return {
          lang: "zh",
          supported: false,
          ambiguous: false,
          source: "simplified_chinese_char",
          message: "Chinese language is not supported in offline dictionary."
        };
      }
    }

    // 4d. Check surrounding context for exclusive Chinese markers
    if (context) {
      for (const char of context) {
        if (EXCLUSIVE_SIMPLIFIED_CHINESE_MARKERS.has(char)) {
          return {
            lang: "zh",
            supported: false,
            ambiguous: false,
            source: "context_chinese",
            message: "Chinese language is not supported in offline dictionary."
          };
        }
      }
    }

    // 4e. Pure Kanji without Kana is ambiguous, priority is Japanese dictionary lookup
    return { lang: "ja", supported: true, ambiguous: true, source: "ambiguous_kanji" };
  }

  // 5. Fallback default
  return { lang: "en", supported: true, ambiguous: false, source: "default" };
}
