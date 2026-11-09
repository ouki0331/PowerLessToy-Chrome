/**
 * Multi-layer Language Detection for Dictionary Lookups (DICT-LANG-001)
 *
 * Priority order:
 * 1. Command prefix / user override (dict ja, dict en, 辞書)
 * 2. Script features (Kana -> ja, Latin -> en)
 * 3. Ambiguous Kanji analysis (detect simplified Chinese vs Japanese kanji)
 * 4. Surrounding context sentence
 * 5. HTML lang attribute
 *
 * Rules:
 * - AI does NOT perform base language detection.
 * - Chinese is NOT supported: when Chinese is detected, return supported: false with a clear explanation.
 */

// Characters distinctive to Simplified Chinese (not present in modern Japanese joyo/jinmeiyo kanji)
const SIMPLIFIED_CHINESE_MARKERS = new Set([
  "词", "典", "语", "译", "这", "么", "们", "汉", "点", "设", "计",
  "门", "见", "观", "规", "话", "认", "识", "说", "请", "读", "写",
  "买", "卖", "车", "东", "发", "个", "给", "后", "会", "机", "几",
  "开", "来", "乐", "两", "关", "头", "问", "为", "无", "学", "样",
  "应", "张", "长", "只", "种", "对", "带", "动", "电", "从", "产"
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
    return { lang: "en", supported: true, ambiguous: false };
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
    // Check for distinctive Chinese characters
    for (const char of target) {
      if (SIMPLIFIED_CHINESE_MARKERS.has(char)) {
        return {
          lang: "zh",
          supported: false,
          ambiguous: false,
          source: "simplified_chinese_char",
          message: "Chinese language is not supported in offline dictionary."
        };
      }
    }

    // Check surrounding context for Kana or Chinese markers
    if (context) {
      if (KANA_REGEX.test(context)) {
        return { lang: "ja", supported: true, ambiguous: false, source: "context_kana" };
      }
      for (const char of context) {
        if (SIMPLIFIED_CHINESE_MARKERS.has(char)) {
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

    // Check HTML language tag
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

    // Pure Kanji without Kana is ambiguous, default to Japanese dictionary lookup
    return { lang: "ja", supported: true, ambiguous: true, source: "ambiguous_kanji" };
  }

  // Fallback default
  return { lang: "en", supported: true, ambiguous: false, source: "default" };
}
