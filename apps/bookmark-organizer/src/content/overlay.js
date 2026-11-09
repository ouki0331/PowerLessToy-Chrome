/**
 * In-Page Spotlight Overlay & Quick Page Capture (CMD-SEARCH-001 & BMK-CAPTURE-001)
 *
 * Implements:
 * - In-page overlay isolated via Shadow DOM (#powerless-toy-overlay-host).
 * - Triggered via shortcut (Ctrl+Shift+K / Command+Shift+K) or extension action.
 * - Single continuous stream: Commands listed first, Bookmarks listed second.
 * - Scope toggling: pressing Ctrl+Shift+K / Command+Shift+K while open toggles
 *   between "all" and "bookmarks" without losing query text or input focus.
 * - ArrowUp / ArrowDown navigation, Enter to open/run, Ctrl/Cmd+Enter for new tab.
 * - Quick Capture view in the same overlay with tracking cleaner, group combobox,
 *   custom tag reset on clear, duplicate detection, and background persistence.
 * - Focus restoration to host page active element on close.
 */

(function () {
  // Prevent execution if running in Node.js test environment without DOM
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  // If already loaded in page, wire toggle helper and exit
  if (window.__POWERLESS_TOY_OVERLAY_INITIALIZED__) {
    if (typeof window.__POWERLESS_TOY_TOGGLE_OVERLAY__ === "function") {
      window.__POWERLESS_TOY_TOGGLE_OVERLAY__();
    }
    return;
  }
  window.__POWERLESS_TOY_OVERLAY_INITIALIZED__ = true;

  // Tracking query parameters
  const TRACKING_PATTERNS = [
    /^utm_/i,
    /^gclid$/i,
    /^dclid$/i,
    /^fbclid$/i,
    /^msclkid$/i,
    /^yclid$/i,
    /^mc_cid$/i,
    /^mc_eid$/i
  ];

  function cleanTrackingUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    const trimmed = rawUrl.trim();
    if (!trimmed) return "";
    try {
      const urlObj = new URL(trimmed);
      const toDelete = [];
      for (const key of urlObj.searchParams.keys()) {
        if (TRACKING_PATTERNS.some((pat) => pat.test(key))) {
          toDelete.push(key);
        }
      }
      for (const key of toDelete) {
        urlObj.searchParams.delete(key);
      }
      return urlObj.toString();
    } catch {
      return trimmed;
    }
  }

  function normalizeComparableUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    const cleaned = cleanTrackingUrl(rawUrl);
    try {
      const parsed = new URL(cleaned);
      let pathname = parsed.pathname.replace(/\/+$/, "");
      const search = parsed.search || "";
      const hash = parsed.hash || "";
      return `${parsed.protocol}//${parsed.host}${pathname}${search}${hash}`.toLowerCase();
    } catch {
      return cleaned.toLowerCase();
    }
  }

  function findDuplicateLink(data, url) {
    if (!data || !Array.isArray(data.links) || !url) return null;
    const targetNorm = normalizeComparableUrl(url);
    if (!targetNorm) return null;

    const found = data.links.find((l) => l && normalizeComparableUrl(l.url) === targetNorm);
    if (!found) return null;

    const group = (data.groups || []).find((g) => g.id === found.groupId) || null;
    const category = group ? (data.categories || []).find((c) => c.id === group.categoryId) || null : null;

    return {
      link: found,
      group,
      category,
      groupName: group?.name || "",
      categoryName: category?.name || ""
    };
  }

  function filterGroupsForCombobox(data, query = "", recentGroupMetrics = new Map()) {
    if (!data || !Array.isArray(data.groups)) return [];
    const categories = data.categories || [];
    const catMap = new Map(categories.map((c) => [c.id, c]));
    const links = data.links || [];
    const linksByGroup = new Map();
    for (const l of links) {
      if (!l) continue;
      if (!linksByGroup.has(l.groupId)) linksByGroup.set(l.groupId, []);
      linksByGroup.get(l.groupId).push(l);
    }

    const trimmed = (query || "").trim().toLowerCase();
    const sanitized = trimmed.replace(/[()[\]{}]/g, " ");
    const tokens = sanitized ? sanitized.split(/\s+/).filter(Boolean) : [];

    const results = [];
    for (const group of data.groups) {
      if (!group) continue;
      const category = catMap.get(group.categoryId);
      const groupLinks = linksByGroup.get(group.id) || [];
      const linkCount = groupLinks.length;
      const metric = recentGroupMetrics.get(group.id);
      const lastUsedAt = metric?.lastUsedAt || group.lastUsedAt || 0;
      const usageCount = metric?.usageCount || group.usageCount || 0;

      const gName = (group.name || "").toLowerCase();
      const cName = (category?.name || "").toLowerCase();
      const lNames = groupLinks.map((l) => (l.name || "").toLowerCase()).join(" ");
      const lHosts = groupLinks.map((l) => {
        try { return new URL(l.url).hostname.toLowerCase(); } catch { return ""; }
      }).join(" ");

      const fullText = `${gName} ${cName} ${lNames} ${lHosts}`;
      const matches = tokens.length === 0 || tokens.every((t) => fullText.includes(t));

      if (matches) {
        results.push({
          id: group.id,
          name: group.name,
          categoryId: group.categoryId,
          categoryName: category?.name || "Uncategorized",
          linkCount,
          lastUsedAt,
          usageCount
        });
      }
    }

    results.sort((a, b) => (b.lastUsedAt - a.lastUsedAt) || (b.usageCount - a.usageCount) || a.name.localeCompare(b.name));
    return results;
  }

  // SVG Icons
  const ICONS = {
    search: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
    bookmark: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`,
    heartFilled: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>`,
    command: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"></path></svg>`,
    externalLink: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`,
    lock: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
    unlock: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`,
    import: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path><polyline points="7 11 12 16 17 11"></polyline><line x1="12" y1="4" x2="12" y2="16"></line></svg>`,
    export: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`,
    close: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
    chevronDown: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
    checkCircle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
    book: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`,
    sparkles: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4z"></path></svg>`
  };

  // Localized string dictionary
  const STRINGS = {
    en: {
      placeholderAll: "Search commands or bookmarks...",
      placeholderBookmarks: "Search bookmarks only...",
      scopeHint: "Ctrl+Shift+K: Toggle scope",
      scopeHintMac: "⌘⇧K: Toggle scope",
      navHint: "↑↓ Select · Enter Open · Ctrl+Enter New Tab · Esc Close",
      navHintMac: "↑↓ Select · Enter Open · ⌘+Enter New Tab · Esc Close",
      sectionCommands: "Commands",
      sectionBookmarks: "Bookmarks",
      sectionRecent: "Recent Bookmarks",
      cmdCaptureTitle: "Capture Current Page",
      cmdCaptureDesc: "Save this URL, title, and environment to your bookmark shelf",
      cmdWorkbenchTitle: "Open Bookmark Manager",
      cmdWorkbenchDesc: "Manage categories, groups, links, and workspace preferences",
      showHiddenTitle: "Show Private Bookmarks",
      hideHiddenTitle: "Hide Private Bookmarks",
      cmdTogglePrivateDesc: "Toggle visibility of hidden bookmarks in results",
      cmdImportTitle: "Import Bookmarks",
      cmdImportDesc: "Import links from Chrome/Netscape HTML or JSON backup",
      cmdExportTitle: "Export Backup",
      cmdExportDesc: "Export bookmarks as JSON backup or Netscape HTML file",
      noResults: "No matching commands or bookmarks found",
      captureHeading: "Capture Current Page",
      captureBack: "Search",
      captureTitleLabel: "Title",
      captureUrlLabel: "URL",
      captureRevertUrl: "Use Original URL",
      captureCleanUrl: "Use Cleaned URL",
      captureCleanedBadge: "Cleaned",
      captureGroupLabel: "Target Group",
      captureGroupPlaceholder: "Search group by name, tab, or existing link...",
      captureSelectGroupHint: "Please select a target group from the list",
      captureNoGroupsCreated: "No groups created yet.",
      captureNoGroupsCreatedHint: "No groups created yet. Please create a group in Bookmark Manager first.",
      captureOpenWorkbenchToCreate: "Open Bookmark Manager to create Group",
      captureNoGroupsMatch: "No matching groups found",
      captureTagLabel: "Tag / Environment",
      captureCustomTagPlaceholder: "Custom tag...",
      captureDuplicateTitle: "Duplicate Bookmark Detected",
      captureSaveBtn: "Save Bookmark",
      captureCancelBtn: "Cancel",
      captureSavedToast: "Bookmark saved!",
      dictExplainWithAiBtn: "Explain in Context with AI",
      dictAiExplaining: "Analyzing context with AI...",
      dictAiExplanationTitle: "AI Context Explanation (BYOK)",
      dictNoDefinitionsFound: "No dictionary definitions found for this word."
    },
    ja: {
      placeholderAll: "コマンドまたはブックマークを検索...",
      placeholderBookmarks: "ブックマークのみを検索...",
      scopeHint: "Ctrl+Shift+K: 範囲を切替",
      scopeHintMac: "⌘⇧K: 範囲を切替",
      navHint: "↑↓ 選択 · Enter 開く · Ctrl+Enter 新規タブ · Esc 閉じる",
      navHintMac: "↑↓ 選択 · Enter 開く · ⌘+Enter 新規タブ · Esc 閉じる",
      sectionCommands: "コマンド",
      sectionBookmarks: "ブックマーク",
      sectionRecent: "最近のブックマーク",
      cmdCaptureTitle: "現在のページを保存",
      cmdCaptureDesc: "現在のURL、タイトル、タグをブックマーク棚に保存",
      cmdWorkbenchTitle: "ブックマーク管理を開く",
      cmdWorkbenchDesc: "カテゴリ、グループ、リンク、設定を管理",
      showHiddenTitle: "プライベートブックマークを表示",
      hideHiddenTitle: "プライベートブックマークを隠す",
      cmdTogglePrivateDesc: "非表示ブックマークの表示/非表示を切り替え",
      cmdImportTitle: "ブックマークのインポート",
      cmdImportDesc: "HTML または JSON バックアップからインポート",
      cmdExportTitle: "バックアップのエクスポート",
      cmdExportDesc: "JSON または HTML ファイルとしてエクスポート",
      noResults: "一致するコマンドまたはブックマークがありません",
      captureHeading: "現在のページを保存",
      captureBack: "検索に戻る",
      captureTitleLabel: "タイトル",
      captureUrlLabel: "URL",
      captureRevertUrl: "元のURLを使用",
      captureCleanUrl: "短縮URLを使用",
      captureCleanedBadge: "パラメータ除去済",
      captureGroupLabel: "保存先グループ",
      captureGroupPlaceholder: "グループ名、タブ、リンクで検索...",
      captureSelectGroupHint: "リストから保存先グループを選択してください",
      captureNoGroupsCreated: "グループがまだ作成されていません。",
      captureNoGroupsCreatedHint: "グループがまだ作成されていません。先にブックマークマネージャーで作成してください。",
      captureOpenWorkbenchToCreate: "ブックマークマネージャーを開いて作成",
      captureNoGroupsMatch: "一致するグループが見つかりません",
      captureTagLabel: "タグ / 環境",
      captureCustomTagPlaceholder: "カスタムタグ...",
      captureDuplicateTitle: "既存の重複ブックマークを検出",
      captureSaveBtn: "ブックマークを保存",
      captureCancelBtn: "キャンセル",
      captureSavedToast: "ブックマークを保存しました",
      dictExplainWithAiBtn: "AI で文脈解説",
      dictAiExplaining: "AI で文脈を分析中...",
      dictAiExplanationTitle: "AI 文脈解説 (BYOK)",
      dictNoDefinitionsFound: "この単語の辞書定義が見つかりませんでした。"
    }
  };

  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  // Overlay state
  const state = {
    isOpen: false,
    scope: "all", // "all" | "bookmarks"
    query: "",
    selectedIndex: 0,
    items: [],
    data: null,
    linkMetrics: new Map(),
    groupMetrics: new Map(),
    lang: "en",
    shortcutStatus: null,
    isPrivateUnlocked: false,
    previousActiveElement: null,
    comboboxHighlightedIndex: -1,
    comboboxMatches: [],
    capture: {
      originalUrl: "",
      cleanedUrl: "",
      isCleaned: false,
      selectedGroupId: "",
      selectedTag: "",
      duplicate: null
    }
  };

  function getI18n() {
    return STRINGS[state.lang] || STRINGS.en;
  }

  function renderSvg(target, svgStr) {
    if (!target || !svgStr) return;
    try {
      const doc = new DOMParser().parseFromString(svgStr.trim(), "image/svg+xml");
      const root = doc.documentElement;
      if (root && root.nodeName.toLowerCase() === "svg") {
        target.replaceChildren(document.importNode(root, true));
      }
    } catch {}
  }

  // Create Host and Shadow Root
  let host = document.getElementById("powerless-toy-overlay-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "powerless-toy-overlay-host";
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483647";
    host.style.display = "none";
    host.style.pointerEvents = "auto";
    document.documentElement.appendChild(host);
  }

  const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });

  // Inject Styles into Shadow Root
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    :host {
      --bg-surface: #ffffff;
      --bg-subtle: #f5f5f7;
      --bg-hover: rgba(0, 0, 0, 0.04);
      --border-subtle: rgba(0, 0, 0, 0.08);
      --border-strong: rgba(0, 0, 0, 0.16);
      --text-main: #1d1d1f;
      --text-secondary: #515154;
      --text-muted: #86868b;
      --primary: #0071e3;
      --primary-hover: #0077ed;
      --primary-subtle: rgba(0, 113, 227, 0.09);
      --primary-border: rgba(0, 113, 227, 0.28);
      --danger: #df382b;
      --danger-subtle: rgba(223, 56, 43, 0.08);
      --danger-border: rgba(223, 56, 43, 0.25);
      --success: #34c759;
      --badge-local-bg: rgba(52, 199, 89, 0.12);
      --badge-local-text: #1d7335;
      --badge-dev-bg: rgba(0, 122, 255, 0.10);
      --badge-dev-text: #0056b3;
      --badge-test-bg: rgba(255, 149, 0, 0.12);
      --badge-test-text: #995400;
      --badge-prod-bg: rgba(175, 82, 222, 0.12);
      --badge-prod-text: #68258c;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      color: var(--text-main);
      box-sizing: border-box;
    }

    @media (prefers-color-scheme: dark) {
      :host {
        --bg-surface: #1e1e20;
        --bg-subtle: #141416;
        --bg-hover: rgba(255, 255, 255, 0.06);
        --border-subtle: rgba(255, 255, 255, 0.10);
        --border-strong: rgba(255, 255, 255, 0.18);
        --text-main: #f5f5f7;
        --text-secondary: #a1a1a6;
        --text-muted: #86868b;
        --primary: #2997ff;
        --primary-hover: #47a7ff;
        --primary-subtle: rgba(41, 151, 255, 0.14);
        --primary-border: rgba(41, 151, 255, 0.35);
        --danger: #ff453a;
        --danger-subtle: rgba(255, 69, 58, 0.12);
        --danger-border: rgba(255, 69, 58, 0.30);
        --badge-local-bg: rgba(50, 215, 75, 0.16);
        --badge-local-text: #4cd964;
        --badge-dev-bg: rgba(10, 132, 255, 0.16);
        --badge-dev-text: #5ac8fa;
        --badge-test-bg: rgba(255, 159, 10, 0.16);
        --badge-test-text: #ff9f0a;
        --badge-prod-bg: rgba(191, 90, 242, 0.16);
        --badge-prod-text: #bf5af2;
      }
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .pt-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 12vh 16px 24px;
      overflow-y: auto;
    }

    .pt-dialog {
      width: 720px;
      max-width: 100%;
      background: var(--bg-surface);
      border: 1px solid var(--border-strong);
      border-radius: 14px;
      box-shadow: 0 24px 54px rgba(0, 0, 0, 0.32);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      max-height: 70vh;
      animation: pt-slide-down 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes pt-slide-down {
      from {
        opacity: 0;
        transform: translateY(-8px) scale(0.99);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    /* Search View */
    .pt-search-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-subtle);
    }

    .pt-search-icon {
      color: var(--text-muted);
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }

    .pt-search-input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font-size: 16px;
      color: var(--text-main);
      font-family: inherit;
    }

    .pt-search-input::placeholder {
      color: var(--text-muted);
    }

    .pt-clear-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      padding: 4px;
      border-radius: 6px;
    }

    .pt-clear-btn:hover {
      background: var(--bg-hover);
      color: var(--text-main);
    }

    .pt-results-body {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .pt-section-header {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      padding: 8px 10px 4px;
    }

    .pt-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 12px;
      min-height: 48px;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid transparent;
      user-select: none;
    }

    .pt-item:hover {
      background: var(--bg-hover);
    }

    .pt-item.is-selected {
      background: var(--primary-subtle);
      border-color: var(--primary-border);
    }

    .pt-item-left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      flex: 1;
    }

    .pt-item-icon {
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }

    .pt-item.is-selected .pt-item-icon {
      color: var(--primary);
    }

    .pt-item-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }

    .pt-item-title-row {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .pt-item-title {
      font-size: 13.5px;
      font-weight: 600;
      color: var(--text-main);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pt-item-desc {
      font-size: 12px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pt-item-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      flex-shrink: 0;
    }

    .pt-badge-local { background: var(--badge-local-bg); color: var(--badge-local-text); }
    .pt-badge-dev { background: var(--badge-dev-bg); color: var(--badge-dev-text); }
    .pt-badge-test { background: var(--badge-test-bg); color: var(--badge-test-text); }
    .pt-badge-prod { background: var(--badge-prod-bg); color: var(--badge-prod-text); }
    .pt-badge-custom { background: var(--bg-hover); color: var(--text-secondary); }

    .pt-item-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .pt-breadcrumb {
      font-size: 11px;
      color: var(--text-secondary);
      background: var(--bg-subtle);
      padding: 2px 8px;
      border-radius: 4px;
      white-space: nowrap;
    }

    .pt-empty-state {
      padding: 36px 16px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
    }

    .pt-footer {
      padding: 8px 16px;
      border-top: 1px solid var(--border-subtle);
      background: var(--bg-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: var(--text-muted);
    }

    .pt-footer-scope {
      font-weight: 600;
      color: var(--text-secondary);
    }

    /* Quick Capture View */
    .pt-capture-view {
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 16px 20px 80px 20px;
      gap: 14px;
    }

    .pt-capture-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 12px;
    }

    .pt-capture-back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: transparent;
      border: none;
      color: var(--primary);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 6px;
    }

    .pt-capture-back-btn:hover {
      background: var(--primary-subtle);
    }

    .pt-capture-title-heading {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-main);
    }

    .pt-form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .pt-form-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
    }

    .pt-form-input {
      border: 1px solid var(--border-strong);
      background: var(--bg-surface);
      color: var(--text-main);
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      width: 100%;
    }

    .pt-form-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px var(--primary-subtle);
    }

    .pt-url-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .pt-url-revert-btn {
      background: transparent;
      border: none;
      color: var(--primary);
      font-size: 11px;
      cursor: pointer;
      text-decoration: underline;
    }

    .pt-url-clean-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--success);
      margin-top: 4px;
    }

    .pt-combobox-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .pt-combobox-input {
      padding-right: 32px !important;
      width: 100%;
    }

    .pt-combobox-toggle-btn {
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      border-radius: 4px;
    }

    .pt-combobox-toggle-btn:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }

    .pt-group-suggestions {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      background: var(--bg-surface);
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      box-shadow: 0 10px 28px rgba(0,0,0,0.24);
      max-height: 200px;
      overflow-y: auto;
      z-index: 1000;
      padding: 4px;
    }

    .pt-combobox-empty {
      padding: 10px 12px;
      font-size: 11.5px;
      color: var(--text-muted);
      text-align: center;
    }

    .pt-combobox-create-btn {
      display: inline-block;
      margin-top: 6px;
      background: var(--primary-subtle);
      color: var(--primary);
      border: 1px solid var(--primary);
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 11px;
      cursor: pointer;
    }

    /* Dictionary card in Spotlight */
    .pt-dict-card {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .pt-dict-header {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-wrap: wrap;
    }

    .pt-dict-word {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .pt-dict-reading {
      font-size: 14px;
      color: var(--text-secondary);
    }

    .pt-dict-pos-tag {
      font-size: 10.5px;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--primary-subtle);
      color: var(--primary);
      font-weight: 500;
    }

    .pt-dict-senses {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-left: 4px;
    }

    .pt-dict-sense-item {
      font-size: 13px;
      color: var(--text-primary);
      line-height: 1.45;
    }

    .pt-dict-sense-num {
      font-weight: 600;
      color: var(--text-muted);
      margin-right: 6px;
    }

    .pt-dict-sense-example {
      font-size: 12px;
      color: var(--text-secondary);
      font-style: italic;
      margin-top: 2px;
      margin-left: 18px;
    }

    .pt-dict-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 6px;
      flex-wrap: wrap;
      gap: 8px;
    }

    .pt-dict-attribution {
      font-size: 11px;
      color: var(--text-muted);
    }

    .pt-dict-ai-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid var(--primary);
      background: var(--primary-subtle);
      color: var(--primary);
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }

    .pt-dict-ai-btn:hover {
      background: var(--primary);
      color: #fff;
    }

    .pt-dict-ai-box {
      margin-top: 8px;
      padding: 10px 12px;
      border-radius: 6px;
      background: var(--bg-hover);
      border-left: 3px solid var(--primary);
      font-size: 12.5px;
      line-height: 1.45;
    }

    .pt-dict-ai-box-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--primary);
      margin-bottom: 4px;
    }

    .pt-combobox-item {
      display: flex;
      justify-content: space-between;
      padding: 7px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12.5px;
    }

    .pt-combobox-item:hover, .pt-combobox-item.is-highlighted {
      background: var(--primary-subtle);
      color: var(--primary);
    }

    .pt-combobox-cat {
      font-size: 11px;
      color: var(--text-muted);
    }

    .pt-hint-error {
      font-size: 11.5px;
      color: var(--danger);
      margin-top: 3px;
    }

    .pt-tag-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .pt-tag-chip {
      background: var(--bg-subtle);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
    }

    .pt-tag-chip:hover {
      background: var(--bg-hover);
    }

    .pt-tag-chip.is-active {
      background: var(--primary);
      color: #ffffff;
      border-color: var(--primary);
    }

    .pt-custom-tag-input {
      width: 140px;
      padding: 5px 8px;
      font-size: 11.5px;
    }

    .pt-duplicate-alert {
      background: var(--danger-subtle);
      border: 1px solid var(--danger-border);
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
    }

    .pt-duplicate-alert strong {
      color: var(--danger);
    }

    .pt-capture-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding-top: 8px;
      border-top: 1px solid var(--border-subtle);
    }

    .pt-btn {
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
    }

    .pt-btn-secondary {
      background: var(--bg-subtle);
      border-color: var(--border-strong);
      color: var(--text-main);
    }

    .pt-btn-secondary:hover {
      background: var(--bg-hover);
    }

    .pt-btn-primary {
      background: var(--primary);
      color: #ffffff;
    }

    .pt-btn-primary:hover:not(:disabled) {
      background: var(--primary-hover);
    }

    .pt-btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .pt-toast {
      position: absolute;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--text-main);
      color: var(--bg-surface);
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    }
  `;
  shadow.appendChild(styleEl);

  // Template Container
  const container = document.createElement("div");
  container.className = "pt-backdrop";
  container.innerHTML = `
    <div class="pt-dialog" role="dialog" aria-modal="true">
      <!-- Search View -->
      <div id="searchView" style="display: flex; flex-direction: column; overflow: hidden; height: 100%;">
        <div class="pt-search-bar">
          <span class="pt-search-icon">${ICONS.search}</span>
          <input type="text" id="searchInput" class="pt-search-input" autocomplete="off" spellcheck="false" />
          <button type="button" id="clearBtn" class="pt-clear-btn" style="display: none;" aria-label="Clear">${ICONS.close}</button>
        </div>
        <div class="pt-results-body" id="resultsBody" role="listbox"></div>
        <div class="pt-empty-state" id="emptyState" style="display: none;"></div>
        <div class="pt-footer">
          <span class="pt-footer-scope" id="footerScope"></span>
          <span id="footerNav"></span>
          <span id="footerWarning" style="display: none; color: var(--danger); cursor: pointer; text-decoration: underline;"></span>
        </div>
      </div>

      <!-- Quick Capture View -->
      <div id="captureView" class="pt-capture-view" style="display: none;">
        <div class="pt-capture-header">
          <button type="button" id="captureBackBtn" class="pt-capture-back-btn">
            ${ICONS.chevronDown}
            <span id="captureBackLabel"></span>
          </button>
          <span class="pt-capture-title-heading" id="captureHeading"></span>
        </div>

        <div class="pt-form-group">
          <label class="pt-form-label" id="labelTitle"></label>
          <input type="text" id="captureTitleInput" class="pt-form-input" required />
        </div>

        <div class="pt-form-group">
          <div class="pt-url-row">
            <label class="pt-form-label" id="labelUrl"></label>
            <button type="button" id="revertUrlBtn" class="pt-url-revert-btn" style="display: none;"></button>
          </div>
          <input type="url" id="captureUrlInput" class="pt-form-input" required />
          <div class="pt-url-clean-status" id="cleanStatus" style="display: none;">
            ${ICONS.checkCircle}
            <span id="cleanStatusText"></span>
          </div>
        </div>

        <div class="pt-form-group">
          <label class="pt-form-label" id="labelGroup"></label>
          <div class="pt-combobox-wrapper">
            <input type="text" id="captureGroupInput" class="pt-form-input pt-combobox-input" autocomplete="off" />
            <button type="button" id="captureGroupToggleBtn" class="pt-combobox-toggle-btn" aria-label="Toggle group suggestions">
              ${ICONS.chevronDown}
            </button>
            <input type="hidden" id="captureGroupId" value="" />
            <div id="groupSuggestions" class="pt-group-suggestions" style="display: none;"></div>
          </div>
          <p id="groupError" class="pt-hint-error" style="display: none;"></p>
        </div>

        <div class="pt-form-group">
          <label class="pt-form-label" id="labelTag"></label>
          <div class="pt-tag-row">
            <div id="tagChips" style="display: flex; gap: 6px;">
              <button type="button" class="pt-tag-chip" data-tag="LOCAL">LOCAL</button>
              <button type="button" class="pt-tag-chip" data-tag="DEV">DEV</button>
              <button type="button" class="pt-tag-chip" data-tag="TEST">TEST</button>
              <button type="button" class="pt-tag-chip" data-tag="PROD">PROD</button>
            </div>
            <input type="text" id="customTagInput" class="pt-form-input pt-custom-tag-input" />
          </div>
        </div>

        <div id="duplicateAlert" class="pt-duplicate-alert" style="display: none;">
          <strong id="duplicateTitle"></strong>
          <span id="duplicateLocation"></span>
        </div>

        <div class="pt-capture-actions">
          <button type="button" id="cancelCaptureBtn" class="pt-btn pt-btn-secondary"></button>
          <button type="button" id="saveCaptureBtn" class="pt-btn pt-btn-primary"></button>
        </div>
      </div>

      <div id="toast" class="pt-toast" style="display: none;">
        ${ICONS.checkCircle}
        <span id="toastText"></span>
      </div>
    </div>
  `;
  shadow.appendChild(container);

  // References inside shadow root
  const els = {
    backdrop: container,
    dialog: container.querySelector(".pt-dialog"),
    searchView: container.querySelector("#searchView"),
    searchInput: container.querySelector("#searchInput"),
    clearBtn: container.querySelector("#clearBtn"),
    resultsBody: container.querySelector("#resultsBody"),
    emptyState: container.querySelector("#emptyState"),
    footerScope: container.querySelector("#footerScope"),
    footerNav: container.querySelector("#footerNav"),
    footerWarning: container.querySelector("#footerWarning"),
    captureView: container.querySelector("#captureView"),
    captureBackBtn: container.querySelector("#captureBackBtn"),
    captureBackLabel: container.querySelector("#captureBackLabel"),
    captureHeading: container.querySelector("#captureHeading"),
    labelTitle: container.querySelector("#labelTitle"),
    captureTitleInput: container.querySelector("#captureTitleInput"),
    labelUrl: container.querySelector("#labelUrl"),
    revertUrlBtn: container.querySelector("#revertUrlBtn"),
    captureUrlInput: container.querySelector("#captureUrlInput"),
    cleanStatus: container.querySelector("#cleanStatus"),
    cleanStatusText: container.querySelector("#cleanStatusText"),
    labelGroup: container.querySelector("#labelGroup"),
    captureGroupInput: container.querySelector("#captureGroupInput"),
    captureGroupToggleBtn: container.querySelector("#captureGroupToggleBtn"),
    captureGroupId: container.querySelector("#captureGroupId"),
    groupSuggestions: container.querySelector("#groupSuggestions"),
    groupError: container.querySelector("#groupError"),
    labelTag: container.querySelector("#labelTag"),
    tagChips: container.querySelector("#tagChips"),
    customTagInput: container.querySelector("#customTagInput"),
    duplicateAlert: container.querySelector("#duplicateAlert"),
    duplicateTitle: container.querySelector("#duplicateTitle"),
    duplicateLocation: container.querySelector("#duplicateLocation"),
    cancelCaptureBtn: container.querySelector("#cancelCaptureBtn"),
    saveCaptureBtn: container.querySelector("#saveCaptureBtn"),
    toast: container.querySelector("#toast"),
    toastText: container.querySelector("#toastText")
  };

  /**
   * Search / Stream Data Assembly
   */
  function getCommands() {
    const t = getI18n();
    const isUnlocked = state.isPrivateUnlocked;

    const commands = [
      {
        type: "command",
        id: "capture",
        title: t.cmdCaptureTitle,
        desc: t.cmdCaptureDesc,
        icon: ICONS.bookmark,
        action: () => openQuickCapture()
      },
      {
        type: "command",
        id: "workbench",
        title: t.cmdWorkbenchTitle,
        desc: t.cmdWorkbenchDesc,
        icon: ICONS.externalLink,
        action: () => {
          chrome.runtime.sendMessage({ type: "OPEN_WORKBENCH" });
          closeOverlay();
        }
      },
      {
        type: "command",
        id: "togglePrivate",
        title: isUnlocked ? t.hideHiddenTitle : t.showHiddenTitle,
        desc: t.cmdTogglePrivateDesc,
        icon: isUnlocked ? ICONS.unlock : ICONS.lock,
        action: () => {
          state.isPrivateUnlocked = !state.isPrivateUnlocked;
          renderStream();
        }
      },
      {
        type: "command",
        id: "import",
        title: t.cmdImportTitle,
        desc: t.cmdImportDesc,
        icon: ICONS.import,
        action: () => {
          chrome.runtime.sendMessage({ type: "OPEN_WORKBENCH", hash: "#import" });
          closeOverlay();
        }
      },
      {
        type: "command",
        id: "export",
        title: t.cmdExportTitle,
        desc: t.cmdExportDesc,
        icon: ICONS.export,
        action: () => {
          chrome.runtime.sendMessage({ type: "OPEN_WORKBENCH", hash: "#export" });
          closeOverlay();
        }
      }
    ];

    if (state.shortcutStatus && !state.shortcutStatus.isBound) {
      commands.push({
        type: "command",
        id: "shortcutsSettings",
        title: state.lang === "ja" ? "拡張機能のショートカットを設定" : "Configure Extension Shortcuts",
        desc: state.lang === "ja" ? "chrome://extensions/shortcuts を開いてショートカットキーを割り当てます" : "Open chrome://extensions/shortcuts to set shortcut keys",
        icon: ICONS.externalLink,
        action: () => {
          chrome.runtime.sendMessage({ type: "OPEN_SHORTCUTS_SETTINGS" });
          closeOverlay();
        }
      });
    }

    if (!state.query) return commands;
    const q = state.query.toLowerCase().trim();
    return commands.filter((c) => c.title.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));
  }

  function getBookmarks() {
    if (!state.data || !Array.isArray(state.data.links)) return [];
    const catMap = new Map((state.data.categories || []).map((c) => [c.id, c]));
    const groupMap = new Map((state.data.groups || []).map((g) => [g.id, g]));

    const links = state.data.links.filter((l) => {
      if (!l) return false;
      if (l.hidden && !state.isPrivateUnlocked) return false;
      return true;
    });

    const q = (state.query || "").trim().toLowerCase();
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];

    const scored = [];
    for (const link of links) {
      const group = groupMap.get(link.groupId);
      const cat = group ? catMap.get(group.categoryId) : null;
      const groupName = group?.name || "";
      const catName = cat?.name || "";
      const title = link.name || "";
      const url = link.url || "";
      const badge = link.badge || "";
      let host = "";
      try { host = new URL(url).hostname; } catch {}

      const fullSearch = `${title} ${url} ${host} ${badge} ${groupName} ${catName}`.toLowerCase();
      const matches = tokens.length === 0 || tokens.every((tok) => fullSearch.includes(tok));

      if (matches) {
        const metric = state.linkMetrics.get(link.id);
        const lastUsedAt = metric?.lastUsedAt || link.lastUsedAt || 0;
        const usageCount = metric?.usageCount || link.usageCount || 0;

        let score = 0;
        if (tokens.length > 0) {
          if (title.toLowerCase().startsWith(q)) score += 50;
          if (title.toLowerCase().includes(q)) score += 25;
          if (host.toLowerCase().includes(q)) score += 15;
          if (badge.toLowerCase() === q) score += 20;
        } else {
          score = link.pinned ? 100 : 0;
        }

        scored.push({
          type: "bookmark",
          link,
          title,
          url,
          badge,
          host,
          groupName,
          categoryName: catName,
          pinned: link.pinned,
          score,
          lastUsedAt,
          usageCount
        });
      }
    }

    if (tokens.length === 0) {
      scored.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.lastUsedAt - a.lastUsedAt) || a.title.localeCompare(b.title));
      return scored.slice(0, 12);
    }

    scored.sort((a, b) => (b.score - a.score) || (b.lastUsedAt - a.lastUsedAt) || a.title.localeCompare(b.title));
    return scored;
  }

  let currentSearchReq = 0;

  async function renderDictionaryResultIfMatch(query) {
    const qTrimmed = (query || "").trim();
    if (!qTrimmed) return false;
    const isDictCommand = /^(?:dict[\s:]|辞書|辞书)/i.test(qTrimmed);
    if (!isDictCommand) return false;

    const reqId = ++currentSearchReq;
    els.resultsBody.replaceChildren();

    const loadingEl = document.createElement("div");
    loadingEl.className = "pt-section-header";
    loadingEl.textContent = "Dictionary Lookup...";
    els.resultsBody.appendChild(loadingEl);

    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "DICT_SEARCH", query: qTrimmed }, (resp) => resolve(resp));
      });

      if (reqId !== currentSearchReq) return true;
      els.resultsBody.replaceChildren();

      if (!res || !res.success) {
        const errEl = document.createElement("div");
        errEl.className = "pt-dict-card";
        errEl.textContent = res?.error || "Dictionary search failed.";
        els.resultsBody.appendChild(errEl);
        return true;
      }

      if (res.isEnabled === false) {
        const card = document.createElement("div");
        card.className = "pt-dict-card";
        card.textContent = res.message || "Dictionary module is currently disabled. Enable it in Settings → Dictionary.";
        els.resultsBody.appendChild(card);
        return true;
      }

      if (res.supported === false || res.packInstalled === false) {
        const card = document.createElement("div");
        card.className = "pt-dict-card";
        card.textContent = res.message;
        els.resultsBody.appendChild(card);
        return true;
      }

      const entries = res.entries || [];
      if (entries.length === 0) {
        const card = document.createElement("div");
        card.className = "pt-dict-card";
        card.textContent = getI18n().dictNoDefinitionsFound || "No dictionary definitions found for this word.";
        els.resultsBody.appendChild(card);
        return true;
      }

      for (const entry of entries) {
        const card = document.createElement("div");
        card.className = "pt-dict-card";

        const header = document.createElement("div");
        header.className = "pt-dict-header";

        const wordEl = document.createElement("span");
        wordEl.className = "pt-dict-word";
        wordEl.textContent = entry.word;
        header.appendChild(wordEl);

        if (entry.reading && entry.reading !== entry.word) {
          const readingEl = document.createElement("span");
          readingEl.className = "pt-dict-reading";
          readingEl.textContent = `[${entry.reading}]`;
          header.appendChild(readingEl);
        }

        if (Array.isArray(entry.pos)) {
          for (const p of entry.pos) {
            const posEl = document.createElement("span");
            posEl.className = "pt-dict-pos-tag";
            posEl.textContent = p;
            header.appendChild(posEl);
          }
        }
        card.appendChild(header);

        // Senses
        const sensesContainer = document.createElement("div");
        sensesContainer.className = "pt-dict-senses";

        const allDefs = [];
        (entry.senses || []).forEach((s, idx) => {
          const item = document.createElement("div");
          item.className = "pt-dict-sense-item";

          const num = document.createElement("span");
          num.className = "pt-dict-sense-num";
          num.textContent = `${idx + 1}.`;
          item.appendChild(num);

          const defText = s.definition || (s.glosses ? s.glosses.join(", ") : "");
          allDefs.push(defText);

          const textSpan = document.createElement("span");
          textSpan.textContent = defText;
          item.appendChild(textSpan);

          if (s.synonyms && s.synonyms.length > 0) {
            const synSpan = document.createElement("span");
            synSpan.style.color = "var(--text-muted)";
            synSpan.style.fontSize = "11.5px";
            synSpan.textContent = ` (syn: ${s.synonyms.join(", ")})`;
            item.appendChild(synSpan);
          }

          if (s.examples && s.examples.length > 0) {
            const exDiv = document.createElement("div");
            exDiv.className = "pt-dict-sense-example";
            exDiv.textContent = `"${s.examples[0]}"`;
            item.appendChild(exDiv);
          }

          sensesContainer.appendChild(item);
        });
        card.appendChild(sensesContainer);

        // Footer with attribution & AI Button
        const footer = document.createElement("div");
        footer.className = "pt-dict-footer";

        const attr = document.createElement("span");
        attr.className = "pt-dict-attribution";
        attr.textContent = res.packInfo?.name ? `${res.packInfo.name} · ${res.packInfo.license}` : "";
        footer.appendChild(attr);

        const aiBtn = document.createElement("button");
        aiBtn.type = "button";
        aiBtn.className = "pt-dict-ai-btn";
        aiBtn.innerHTML = `${ICONS.sparkles} <span>${getI18n().dictExplainWithAiBtn || "Explain with AI"}</span>`;

        const aiBoxContainer = document.createElement("div");
        aiBoxContainer.style.display = "none";

        aiBtn.addEventListener("click", async () => {
          aiBtn.disabled = true;
          aiBtn.innerHTML = `<span>${getI18n().dictAiExplaining || "Analyzing..."}</span>`;

          let contextSentence = "";
          try {
            const sel = window.getSelection()?.toString();
            if (sel && sel.length > 5) {
              contextSentence = sel;
            } else {
              const bodyText = document.body?.innerText || "";
              const wordIdx = bodyText.indexOf(entry.word);
              if (wordIdx !== -1) {
                const start = Math.max(0, wordIdx - 80);
                const end = Math.min(bodyText.length, wordIdx + 120);
                contextSentence = bodyText.slice(start, end).replace(/\s+/g, " ");
              }
            }
          } catch {}

          try {
            const aiResp = await new Promise((resolve) => {
              chrome.runtime.sendMessage({
                type: "DICT_AI_EXPLAIN",
                params: {
                  word: entry.word,
                  language: res.detectedLang,
                  contextSentence,
                  definitions: allDefs
                }
              }, resolve);
            });

            if (aiResp?.success && aiResp.result?.text) {
              aiBoxContainer.className = "pt-dict-ai-box";
              aiBoxContainer.style.display = "block";
              aiBoxContainer.innerHTML = `
                <div class="pt-dict-ai-box-badge">${ICONS.sparkles} ${getI18n().dictAiExplanationTitle || "AI Context Explanation"} (${aiResp.result.provider})</div>
                <div>${aiResp.result.text}</div>
              `;
              aiBtn.style.display = "none";
            } else {
              aiBtn.disabled = false;
              aiBtn.textContent = aiResp?.error || "AI explanation failed";
            }
          } catch (err) {
            aiBtn.disabled = false;
            aiBtn.textContent = err.message;
          }
        });

        footer.appendChild(aiBtn);
        card.appendChild(footer);
        card.appendChild(aiBoxContainer);

        els.resultsBody.appendChild(card);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Render Unified Single Continuous Stream
   */
  function renderStream() {
    const qTrimmed = (state.query || "").trim();
    if (/^(?:dict[\s:]|辞書|辞书)/i.test(qTrimmed)) {
      renderDictionaryResultIfMatch(qTrimmed);
      return;
    }

    const t = getI18n();
    const commands = state.scope === "all" ? getCommands() : [];
    const bookmarks = getBookmarks();

    const flatItems = [...commands, ...bookmarks];
    state.items = flatItems;

    els.resultsBody.replaceChildren();

    if (flatItems.length === 0) {
      els.emptyState.textContent = t.noResults;
      els.emptyState.style.display = "block";
      return;
    }
    els.emptyState.style.display = "none";

    if (state.selectedIndex >= flatItems.length) {
      state.selectedIndex = 0;
    }

    let currentItemIndex = 0;

    // Commands Section
    if (commands.length > 0) {
      const cmdHeader = document.createElement("div");
      cmdHeader.className = "pt-section-header";
      cmdHeader.textContent = t.sectionCommands;
      els.resultsBody.appendChild(cmdHeader);

      for (const cmd of commands) {
        const idx = currentItemIndex++;
        const itemEl = createItemElement(cmd, idx);
        els.resultsBody.appendChild(itemEl);
      }
    }

    // Bookmarks Section
    if (bookmarks.length > 0) {
      const bmkHeader = document.createElement("div");
      bmkHeader.className = "pt-section-header";
      bmkHeader.textContent = state.query ? t.sectionBookmarks : t.sectionRecent;
      els.resultsBody.appendChild(bmkHeader);

      for (const bmk of bookmarks) {
        const idx = currentItemIndex++;
        const itemEl = createItemElement(bmk, idx);
        els.resultsBody.appendChild(itemEl);
      }
    }

    scrollSelectedIntoView();
  }

  function createItemElement(item, index) {
    const isSelected = index === state.selectedIndex;
    const el = document.createElement("div");
    el.className = `pt-item ${isSelected ? "is-selected" : ""}`;
    el.setAttribute("role", "option");
    el.setAttribute("aria-selected", isSelected ? "true" : "false");

    const left = document.createElement("div");
    left.className = "pt-item-left";

    const iconSpan = document.createElement("span");
    iconSpan.className = "pt-item-icon";
    if (item.type === "command") {
      renderSvg(iconSpan, item.icon);
    } else {
      renderSvg(iconSpan, item.pinned ? ICONS.heartFilled : ICONS.bookmark);
    }
    left.appendChild(iconSpan);

    const text = document.createElement("div");
    text.className = "pt-item-text";

    const titleRow = document.createElement("div");
    titleRow.className = "pt-item-title-row";

    const title = document.createElement("span");
    title.className = "pt-item-title";
    title.textContent = item.title;
    titleRow.appendChild(title);

    if (item.badge) {
      const badge = document.createElement("span");
      const bLower = item.badge.toLowerCase();
      badge.className = `pt-item-badge ${
        ["local", "dev", "test", "prod"].includes(bLower) ? `pt-badge-${bLower}` : "pt-badge-custom"
      }`;
      badge.textContent = item.badge;
      titleRow.appendChild(badge);
    }
    text.appendChild(titleRow);

    const desc = document.createElement("span");
    desc.className = "pt-item-desc";
    if (item.type === "command") {
      desc.textContent = item.desc;
    } else {
      desc.textContent = `${item.host} · ${item.url}`;
    }
    text.appendChild(desc);
    left.appendChild(text);
    el.appendChild(left);

    if (item.type === "bookmark" && (item.categoryName || item.groupName)) {
      const right = document.createElement("div");
      right.className = "pt-item-right";
      const crumb = document.createElement("span");
      crumb.className = "pt-breadcrumb";
      crumb.textContent = `${item.categoryName} › ${item.groupName}`;
      right.appendChild(crumb);
      el.appendChild(right);
    }

    el.addEventListener("click", () => {
      state.selectedIndex = index;
      executeSelectedItem({ inBackground: false });
    });

    return el;
  }

  function scrollSelectedIntoView() {
    const selected = els.resultsBody.querySelector(".pt-item.is-selected");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }

  function executeSelectedItem({ inBackground = false } = {}) {
    const item = state.items[state.selectedIndex];
    if (!item) return;

    if (item.type === "command") {
      if (typeof item.action === "function") {
        item.action();
      }
    } else if (item.type === "bookmark") {
      chrome.runtime.sendMessage({
        type: "OPEN_URL",
        url: item.link.url,
        inBackground
      });
      closeOverlay();
    }
  }

  /**
   * Scope Toggle: All <-> Bookmarks
   */
  function toggleScope() {
    state.scope = state.scope === "all" ? "bookmarks" : "all";
    state.selectedIndex = 0;
    updateScopeLabels();
    renderStream();
    els.searchInput.focus();
  }

  function updateScopeLabels() {
    const t = getI18n();
    els.searchInput.placeholder = state.scope === "all" ? t.placeholderAll : t.placeholderBookmarks;
    els.footerScope.textContent = isMac ? t.scopeHintMac : t.scopeHint;
    els.footerNav.textContent = isMac ? t.navHintMac : t.navHint;

    if (state.shortcutStatus && !state.shortcutStatus.isBound) {
      els.footerWarning.textContent = state.lang === "ja"
        ? "⚠️ ショートカット未設定 (クリックして設定)"
        : "⚠️ Shortcut not set (click to configure)";
      els.footerWarning.style.display = "inline";
      els.footerWarning.onclick = () => {
        chrome.runtime.sendMessage({ type: "OPEN_SHORTCUTS_SETTINGS" });
      };
    } else {
      els.footerWarning.style.display = "none";
    }
  }

  /**
   * Quick Page Capture View
   */
  function openQuickCapture() {
    els.searchView.style.display = "none";
    els.captureView.style.display = "flex";

    const t = getI18n();
    els.captureBackLabel.textContent = t.captureBack;
    els.captureHeading.textContent = t.captureHeading;
    els.labelTitle.textContent = t.captureTitleLabel;
    els.labelUrl.textContent = t.captureUrlLabel;
    els.labelGroup.textContent = t.captureGroupLabel;
    els.captureGroupInput.placeholder = t.captureGroupPlaceholder;
    els.labelTag.textContent = t.captureTagLabel;
    els.customTagInput.placeholder = t.captureCustomTagPlaceholder;
    els.duplicateTitle.textContent = t.captureDuplicateTitle;
    els.cancelCaptureBtn.textContent = t.captureCancelBtn;
    els.saveCaptureBtn.textContent = t.captureSaveBtn;

    const rawUrl = window.location.href;
    const pageTitle = (document.title || "").trim();

    state.capture.originalUrl = rawUrl;
    state.capture.cleanedUrl = cleanTrackingUrl(rawUrl);
    state.capture.isCleaned = state.capture.cleanedUrl !== rawUrl;

    els.captureTitleInput.value = pageTitle || rawUrl;
    els.captureUrlInput.value = state.capture.cleanedUrl;

    if (state.capture.isCleaned) {
      els.cleanStatus.style.display = "flex";
      els.cleanStatusText.textContent = t.captureCleanedBadge;
      els.revertUrlBtn.style.display = "inline";
      els.revertUrlBtn.textContent = t.captureRevertUrl;
    } else {
      els.cleanStatus.style.display = "none";
      els.revertUrlBtn.style.display = "none";
    }

    // Default Group: most recently used
    const groups = filterGroupsForCombobox(state.data, "", state.groupMetrics);
    if (groups.length > 0) {
      const def = groups[0];
      els.captureGroupId.value = def.id;
      els.captureGroupInput.value = `${def.name} (${def.categoryName})`;
      state.capture.selectedGroupId = def.id;
      els.groupError.style.display = "none";
    } else {
      els.captureGroupId.value = "";
      els.captureGroupInput.value = "";
      state.capture.selectedGroupId = "";
      els.groupError.textContent = t.captureNoGroupsCreatedHint;
      els.groupError.style.display = "block";
    }

    // Tags default
    state.capture.selectedTag = "";
    els.customTagInput.value = "";
    els.tagChips.querySelectorAll(".pt-tag-chip").forEach((c) => c.classList.remove("is-active"));

    checkDuplicate(els.captureUrlInput.value);
    els.captureTitleInput.focus();
  }

  function checkDuplicate(url) {
    const dup = findDuplicateLink(state.data, url);
    state.capture.duplicate = dup;

    if (dup) {
      els.duplicateAlert.style.display = "flex";
      els.duplicateLocation.textContent = `${dup.categoryName} › ${dup.groupName} › ${dup.link?.name || ""}`;
      els.saveCaptureBtn.disabled = true;
    } else {
      els.duplicateAlert.style.display = "none";
      validateCaptureSavable();
    }
  }

  function validateCaptureSavable() {
    const hasTitle = Boolean(els.captureTitleInput.value.trim());
    const hasUrl = Boolean(els.captureUrlInput.value.trim());
    const hasGroup = Boolean(state.capture.selectedGroupId);
    const hasDup = Boolean(state.capture.duplicate);

    if (!hasGroup && (!state.data?.groups || state.data.groups.length === 0)) {
      els.groupError.textContent = getI18n().captureNoGroupsCreatedHint;
      els.groupError.style.display = "block";
    } else if (!hasGroup && els.captureGroupInput.value.trim()) {
      els.groupError.textContent = getI18n().captureSelectGroupHint;
      els.groupError.style.display = "block";
    }

    els.saveCaptureBtn.disabled = !hasTitle || !hasUrl || !hasGroup || hasDup;
  }

  function renderGroupSuggestions(query) {
    els.groupSuggestions.replaceChildren();

    if (!state.data?.groups || state.data.groups.length === 0) {
      state.comboboxMatches = [];
      state.comboboxHighlightedIndex = -1;
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "pt-combobox-empty";
      const textDiv = document.createElement("div");
      textDiv.textContent = getI18n().captureNoGroupsCreated;
      const createBtn = document.createElement("button");
      createBtn.type = "button";
      createBtn.className = "pt-combobox-create-btn";
      createBtn.textContent = getI18n().captureOpenWorkbenchToCreate;
      createBtn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "OPEN_WORKBENCH" });
        closeOverlay();
      });
      emptyDiv.appendChild(textDiv);
      emptyDiv.appendChild(createBtn);
      els.groupSuggestions.appendChild(emptyDiv);
      els.groupSuggestions.style.display = "block";
      return;
    }

    const matches = filterGroupsForCombobox(state.data, query, state.groupMetrics);
    state.comboboxMatches = matches;
    state.comboboxHighlightedIndex = -1;

    if (matches.length === 0) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "pt-combobox-empty";
      emptyDiv.textContent = getI18n().captureNoGroupsMatch;
      els.groupSuggestions.appendChild(emptyDiv);
      els.groupSuggestions.style.display = "block";
      return;
    }

    els.groupSuggestions.style.display = "block";
    matches.slice(0, 15).forEach((group) => {
      const row = document.createElement("div");
      row.className = "pt-combobox-item";
      if (group.id === state.capture.selectedGroupId) {
        row.classList.add("is-highlighted");
      }
      const nameEl = document.createElement("span");
      nameEl.textContent = group.name;
      const catEl = document.createElement("span");
      catEl.className = "pt-combobox-cat";
      catEl.textContent = `${group.categoryName} (${group.linkCount})`;
      row.replaceChildren(nameEl, catEl);

      row.addEventListener("click", () => {
        selectGroupCandidate(group);
      });
      els.groupSuggestions.appendChild(row);
    });
  }

  function selectGroupCandidate(group) {
    els.captureGroupId.value = group.id;
    els.captureGroupInput.value = `${group.name} (${group.categoryName})`;
    state.capture.selectedGroupId = group.id;
    els.groupSuggestions.style.display = "none";
    els.groupError.style.display = "none";
    validateCaptureSavable();
  }

  // Group combobox input: typing clears selectedGroupId immediately
  els.captureGroupInput.addEventListener("input", (e) => {
    els.captureGroupId.value = "";
    state.capture.selectedGroupId = "";
    els.groupError.textContent = getI18n().captureSelectGroupHint;
    els.groupError.style.display = "block";
    validateCaptureSavable();
    renderGroupSuggestions(e.target.value.trim());
  });

  els.captureGroupInput.addEventListener("focus", () => {
    renderGroupSuggestions("");
  });

  els.captureGroupInput.addEventListener("click", () => {
    if (els.groupSuggestions.style.display === "none") {
      renderGroupSuggestions("");
    }
  });

  if (els.captureGroupToggleBtn) {
    els.captureGroupToggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (els.groupSuggestions.style.display === "none") {
        els.captureGroupInput.focus();
        renderGroupSuggestions("");
      } else {
        els.groupSuggestions.style.display = "none";
      }
    });
  }

  // Keyboard navigation within group combobox
  els.captureGroupInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (els.groupSuggestions.style.display !== "none") {
        e.preventDefault();
        e.stopPropagation();
        els.groupSuggestions.style.display = "none";
        return;
      }
    }

    if (els.groupSuggestions.style.display === "none") return;

    const items = els.groupSuggestions.querySelectorAll(".pt-combobox-item");
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.comboboxHighlightedIndex = (state.comboboxHighlightedIndex + 1) % items.length;
      items.forEach((it, i) => it.classList.toggle("is-highlighted", i === state.comboboxHighlightedIndex));
      items[state.comboboxHighlightedIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      state.comboboxHighlightedIndex = (state.comboboxHighlightedIndex - 1 + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle("is-highlighted", i === state.comboboxHighlightedIndex));
      items[state.comboboxHighlightedIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (state.comboboxHighlightedIndex >= 0 && state.comboboxMatches[state.comboboxHighlightedIndex]) {
        selectGroupCandidate(state.comboboxMatches[state.comboboxHighlightedIndex]);
      }
    }
  });

  // URL revert / clean toggle
  els.revertUrlBtn.addEventListener("click", () => {
    const t = getI18n();
    if (els.captureUrlInput.value === state.capture.cleanedUrl) {
      els.captureUrlInput.value = state.capture.originalUrl;
      els.revertUrlBtn.textContent = t.captureCleanUrl;
      els.cleanStatus.style.display = "none";
    } else {
      els.captureUrlInput.value = state.capture.cleanedUrl;
      els.revertUrlBtn.textContent = t.captureRevertUrl;
      els.cleanStatus.style.display = "flex";
    }
    checkDuplicate(els.captureUrlInput.value);
  });

  els.captureUrlInput.addEventListener("input", () => {
    checkDuplicate(els.captureUrlInput.value);
  });

  els.captureTitleInput.addEventListener("input", () => {
    validateCaptureSavable();
  });

  // Tag chips click
  els.tagChips.querySelectorAll(".pt-tag-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const tag = chip.getAttribute("data-tag");
      if (state.capture.selectedTag === tag) {
        state.capture.selectedTag = "";
        chip.classList.remove("is-active");
      } else {
        els.tagChips.querySelectorAll(".pt-tag-chip").forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        state.capture.selectedTag = tag;
        els.customTagInput.value = "";
      }
    });
  });

  // Custom Tag Input: clearing immediately resets selectedTag to ""
  els.customTagInput.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    if (val) {
      els.tagChips.querySelectorAll(".pt-tag-chip").forEach((c) => c.classList.remove("is-active"));
      state.capture.selectedTag = val;
    } else {
      state.capture.selectedTag = "";
    }
  });

  // Save Capture Submission
  els.saveCaptureBtn.addEventListener("click", async () => {
    const title = els.captureTitleInput.value.trim();
    const url = els.captureUrlInput.value.trim();
    const groupId = state.capture.selectedGroupId;
    const badge = state.capture.selectedTag || els.customTagInput.value.trim();

    if (!title || !url || !groupId) return;

    try {
      els.saveCaptureBtn.disabled = true;
      const resp = await chrome.runtime.sendMessage({
        type: "SAVE_CAPTURED_LINK",
        name: title,
        url,
        groupId,
        badge
      });

      if (resp?.success) {
        els.toastText.textContent = getI18n().captureSavedToast;
        els.toast.style.display = "flex";
        setTimeout(() => {
          closeOverlay();
        }, 400);
      } else {
        els.saveCaptureBtn.disabled = false;
      }
    } catch {
      els.saveCaptureBtn.disabled = false;
    }
  });

  els.cancelCaptureBtn.addEventListener("click", () => {
    closeOverlay();
  });

  els.captureBackBtn.addEventListener("click", () => {
    els.captureView.style.display = "none";
    els.searchView.style.display = "flex";
    els.searchInput.focus();
  });

  /**
   * Search Input Events
   */
  els.searchInput.addEventListener("input", (e) => {
    state.query = e.target.value;
    state.selectedIndex = 0;
    els.clearBtn.style.display = state.query ? "flex" : "none";
    renderStream();
  });

  els.clearBtn.addEventListener("click", () => {
    state.query = "";
    els.searchInput.value = "";
    els.clearBtn.style.display = "none";
    state.selectedIndex = 0;
    renderStream();
    els.searchInput.focus();
  });

  // Backdrop click closes overlay
  els.backdrop.addEventListener("click", (e) => {
    if (e.target === els.backdrop) {
      closeOverlay();
    }
  });

  // Close combobox when clicking outside
  container.addEventListener("click", (e) => {
    if (!els.captureGroupInput.contains(e.target) && !els.groupSuggestions.contains(e.target) && !els.captureGroupToggleBtn?.contains(e.target)) {
      els.groupSuggestions.style.display = "none";
    }
  });

  /**
   * Keyboard Shortcuts & Event Handling
   */
  container.addEventListener("keydown", (e) => {
    const isShortcut =
      ((e.ctrlKey && !isMac) || (e.metaKey && isMac)) &&
      e.shiftKey &&
      e.key.toLowerCase() === "k";

    if (isShortcut) {
      e.preventDefault();
      e.stopPropagation();
      toggleScope();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (els.captureView.style.display === "flex") {
        els.captureView.style.display = "none";
        els.searchView.style.display = "flex";
        els.searchInput.focus();
      } else {
        closeOverlay();
      }
      return;
    }

    if (els.searchView.style.display === "flex") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (state.items.length > 0) {
          state.selectedIndex = (state.selectedIndex + 1) % state.items.length;
          renderStream();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (state.items.length > 0) {
          state.selectedIndex = (state.selectedIndex - 1 + state.items.length) % state.items.length;
          renderStream();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const inBackground = (e.ctrlKey && !isMac) || (e.metaKey && isMac);
        executeSelectedItem({ inBackground });
      }
    }
  });

  /**
   * Open & Close Life-cycle
   */
  async function openOverlay() {
    state.previousActiveElement = document.activeElement;
    state.isOpen = true;
    state.scope = "all";
    state.query = "";
    state.selectedIndex = 0;
    els.searchInput.value = "";
    els.clearBtn.style.display = "none";
    els.toast.style.display = "none";

    els.searchView.style.display = "flex";
    els.captureView.style.display = "none";

    host.style.display = "block";

    // Fetch fresh data from extension background service worker
    try {
      const resp = await chrome.runtime.sendMessage({ type: "GET_OVERLAY_DATA" });
      if (resp?.success) {
        state.data = resp.data;
        state.linkMetrics = new Map(resp.linkMetrics || []);
        state.groupMetrics = new Map(resp.groupMetrics || []);
        state.lang = resp.lang || "en";
        state.shortcutStatus = resp.shortcutStatus || null;
      }
    } catch (err) {
      console.warn("Failed to load overlay data from background:", err);
    }

    updateScopeLabels();
    if (initialQuery) {
      state.query = initialQuery;
      els.searchInput.value = initialQuery;
      els.clearBtn.style.display = "flex";
    }
    renderStream();

    setTimeout(() => {
      els.searchInput.focus();
      els.searchInput.select();
    }, 20);
  }

  function closeOverlay() {
    state.isOpen = false;
    host.style.display = "none";
    if (state.previousActiveElement && typeof state.previousActiveElement.focus === "function") {
      state.previousActiveElement.focus();
    }
  }

  function toggleOverlay(initialQuery = "") {
    if (state.isOpen) {
      if (initialQuery) {
        state.query = initialQuery;
        els.searchInput.value = initialQuery;
        els.clearBtn.style.display = "flex";
        renderStream();
      } else {
        toggleScope();
      }
    } else {
      openOverlay(initialQuery);
    }
  }

  // Expose toggle function for subsequent injections
  window.__POWERLESS_TOY_TOGGLE_OVERLAY__ = toggleOverlay;

  // Background runtime messaging listener
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "TOGGLE_BOOKMARK_ORGANIZER_OVERLAY") {
        toggleOverlay(message.initialQuery || "");
      }
    });
  }

  // Initial opening upon first on-demand injection
  openOverlay();
})();
