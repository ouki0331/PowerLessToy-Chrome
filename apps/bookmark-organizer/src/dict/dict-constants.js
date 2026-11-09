/**
 * Dictionary Constants & Default Configurations (DICT-SETTINGS-001)
 *
 * Privacy & Boundary Guarantees:
 * - Master switch defaults to OFF (enabled: false).
 * - Zero background queries, zero RAM index, no context menus when disabled.
 * - API keys (BYOK) are stored strictly under AI_KEY_STORAGE_KEY, segregated from workbench data.
 * - Bookmark JSON export NEVER includes dictionary packs, dictionary entries, or API keys.
 */

export const DICT_DB_NAME = "powerless_toy_dict_v1";
export const DICT_DB_VERSION = 1;

export const DICT_STORES = {
  PACKS: "packs",
  ENTRIES: "entries",
  AI_CACHE: "ai_cache",
  HISTORY: "history"
};

export const DICT_SETTINGS_STORAGE_KEY = "powerless_toy_dict_settings";
export const DICT_AI_KEY_STORAGE_KEY = "powerless_toy_dict_ai_key";

export const DEFAULT_DICT_SETTINGS = {
  enabled: false,
  defaultSourceLang: "auto", // "auto" | "ja" | "en"
  uiLang: "auto", // "auto" | "ja" | "en"
  contextMenuEnabled: false,
  aiEnabled: false,
  aiProvider: "gemini", // "gemini" | "openai"
  aiModel: "gemini-1.5-flash",
  installedPacks: {
    ja_jmdict: false,
    en_wordnet: false
  }
};

export const SUPPORTED_LANGUAGES = ["ja", "en"];
export const EXTENSIBLE_LANGUAGES = ["fr", "es"];

export const DICT_MESSAGE_TYPES = {
  SEARCH: "DICT_SEARCH",
  GET_SETTINGS: "DICT_GET_SETTINGS",
  SAVE_SETTINGS: "DICT_SAVE_SETTINGS",
  GET_AI_KEY: "DICT_GET_AI_KEY",
  SAVE_AI_KEY: "DICT_SAVE_AI_KEY",
  INSTALL_PACK: "DICT_INSTALL_PACK",
  UNINSTALL_PACK: "DICT_UNINSTALL_PACK",
  GET_PACK_STATUS: "DICT_GET_PACK_STATUS",
  AI_EXPLAIN: "DICT_AI_EXPLAIN",
  CLEAR_CACHE: "DICT_CLEAR_CACHE",
  CLEAR_HISTORY: "DICT_CLEAR_HISTORY"
};
