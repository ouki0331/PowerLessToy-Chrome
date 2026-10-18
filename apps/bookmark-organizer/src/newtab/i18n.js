/**
 * Internationalization (i18n) for Bookmark Organizer
 * Supports English and Japanese.
 */

const translations = {
  en: {
    appTitle: "Bookmark Organizer",
    tagline: "Quiet Digital Workbench",
    manageMode: "Manage Content",
    doneManaging: "Done Managing",
    addCategory: "+ Add Category",
    addGroup: "+ Add Group",
    addLink: "+ Add Link",
    noGroupsInCat: "No groups in this category yet.",
    noGroupsLead: "Create your first group to start organizing your project environments and links.",
    createFirstGroup: "Create First Group",
    noLinksInGroup: "No links added yet.",
    edit: "Edit",
    delete: "Delete",
    rename: "Rename",
    cancel: "Cancel",
    save: "Save",
    confirmDelete: "Confirm Delete",
    nameLabel: "Name",
    urlLabel: "URL",
    badgeLabel: "Environment / Tag",
    optional: "Optional",
    descriptionLabel: "Description",
    retry: "Retry",
    loadErrorTitle: "Unable to load data",
    loadErrorDesc: "Your stored links have not been modified. Click retry to reload.",
    deleteCategoryTitle: "Delete Category",
    deleteGroupTitle: "Delete Group",
    deleteLinkTitle: "Delete Link",
    categoryDeleteConfirm: (name, gCount, lCount) =>
      `Are you sure you want to delete the category "${name}"? This will permanently delete ${gCount} group(s) and ${lCount} link(s).`,
    groupDeleteConfirm: (name, lCount) =>
      `Are you sure you want to delete the group "${name}"? This will delete ${lCount} link(s).`,
    linkDeleteConfirm: (name, url) =>
      `Are you sure you want to delete the link "${name}" (${url})?`,
    cannotDeleteLastCat: "Cannot delete the only remaining category. At least one category must be kept.",
    fieldRequired: "This field is required.",
    invalidUrl: "Please enter a valid URL (http:// or https://).",
    customBadgePlaceholder: "or custom tag...",
    quickBadges: "Quick tags:",
    switchLang: "Language: EN / JA",
    openNewTabHint: "Click to open in current tab. Ctrl/Cmd+Click to open in new tab.",

    // Import, Export & Safety
    importBtn: "Import JSON",
    exportBtn: "Export Backup",
    importModalTitle: "Import Bookmarks (JSON)",
    importPreviewTitle: "Import Preview & Verification",
    selectJsonFile: "Select a JSON backup file to import:",
    importFileStats: (fileName, cats, grps, lnks) =>
      `File "${fileName}" contains ${cats} category(ies), ${grps} group(s), and ${lnks} link(s).`,
    willAddSummary: (c, g, l) => `Will add: ${c} new categories, ${g} new groups, ${l} new links.`,
    willMergeSummary: (c, g) => `Will merge: ${c} existing categories, ${g} existing groups.`,
    willSkipSummary: (l) => `Will skip: ${l} identical duplicate links.`,
    conflictCountSummary: (c) => `Conflicts found: ${c} links with same URL but different name or tag.`,
    conflictChoiceTitle: "Conflict Resolution:",
    keepExisting: "Keep existing link (Default, safe)",
    keepBoth: "Keep both (Generate new link ID)",
    confirmImportBtn: "Confirm & Import",
    importSuccessTitle: "Import Completed Successfully",
    importSuccessMsg: (added, skipped, conflicts) =>
      `Imported ${added} new links (${skipped} duplicates skipped, ${conflicts} conflicts resolved). An automated safety snapshot was created.`,
    undoImportBtn: "Undo This Import",
    undoSuccessMsg: "The import has been successfully reverted. Pre-existing bookmarks remain untouched.",
    revisionConflictTitle: "Data Conflict Detected",
    revisionConflictMsg:
      "This item was modified in another tab or window. To protect your data, your changes were not overwritten. Please reload to see the latest version.",
    saveFailedTitle: "Save Failed",
    saveFailedMsg: "Could not save your changes to the database. Your input has been preserved. Please retry.",
    migrationErrorDesc: "Legacy storage data is invalid and was preserved untouched:",
    undoBlockedTitle: "Cannot Undo Automatically",
    undoBlockedMsg:
      "Some imported items were edited or new items were added inside them. Automatic undo was blocked to prevent data loss or orphan records. You may restore the pre-import snapshot instead (which will discard changes made after the import).",
    restoreSnapshotConfirmBtn: "Restore Pre-Import Snapshot",
    previewStaleNotice: "Bookmarks changed in another tab while previewing. The preview has been refreshed with the latest data."
  },
  ja: {
    appTitle: "Bookmark Organizer",
    tagline: "環境・リンク整理ワークベンチ",
    manageMode: "コンテンツ管理",
    doneManaging: "完了",
    addCategory: "+ カテゴリ追加",
    addGroup: "+ グループ追加",
    addLink: "+ リンク追加",
    noGroupsInCat: "このカテゴリにはまだグループがありません。",
    noGroupsLead: "最初のグループを作成して、プロジェクトの各環境やリンクを整理しましょう。",
    createFirstGroup: "最初のグループを作成",
    noLinksInGroup: "リンクはまだ登録されていません。",
    edit: "編集",
    delete: "削除",
    rename: "名前変更",
    cancel: "キャンセル",
    save: "保存",
    confirmDelete: "削除の確認",
    nameLabel: "表示名",
    urlLabel: "URL",
    badgeLabel: "環境 / タグ",
    optional: "任意",
    descriptionLabel: "説明",
    retry: "再試行",
    loadErrorTitle: "データの読み込みに失敗しました",
    loadErrorDesc: "保存されているデータは変更されていません。再読み込みをお試しください。",
    deleteCategoryTitle: "カテゴリの削除",
    deleteGroupTitle: "グループの削除",
    deleteLinkTitle: "リンクの削除",
    categoryDeleteConfirm: (name, gCount, lCount) =>
      `カテゴリ「${name}」を削除してもよろしいですか？含まれる ${gCount} 件のグループと ${lCount} 件のリンクもすべて削除されます。`,
    groupDeleteConfirm: (name, lCount) =>
      `グループ「${name}」を削除してもよろしいですか？含まれる ${lCount} 件のリンクも削除されます。`,
    linkDeleteConfirm: (name, url) =>
      `リンク「${name}」(${url}) を削除してもよろしいですか？`,
    cannotDeleteLastCat: "最後のカテゴリは削除できません。最低1つのカテゴリが必要です。",
    fieldRequired: "この項目は必須です。",
    invalidUrl: "有効なURL（http:// または https://）を入力してください。",
    customBadgePlaceholder: "またはカスタムタグ...",
    quickBadges: "クイックタグ:",
    switchLang: "言語: EN / JA",
    openNewTabHint: "クリックで現在のタブで開きます。Ctrl/Cmd+クリックで新しいタブで開きます。",

    // Import, Export & Safety
    importBtn: "JSONインポート",
    exportBtn: "バックアップ書き出し",
    importModalTitle: "ブックマークのインポート (JSON)",
    importPreviewTitle: "インポートプレビューと確認",
    selectJsonFile: "インポートするJSONバックアップファイルを選択してください:",
    importFileStats: (fileName, cats, grps, lnks) =>
      `ファイル「${fileName}」には ${cats} 件のカテゴリ、${grps} 件のグループ、${lnks} 件のリンクが含まれています。`,
    willAddSummary: (c, g, l) => `追加予定: ${c} カテゴリ、${g} グループ、${l} リンク`,
    willMergeSummary: (c, g) => `マージ予定: ${c} 既存カテゴリ、${g} 既存グループ`,
    willSkipSummary: (l) => `スキップ予定: ${l} 件（完全一致の重複リンク）`,
    conflictCountSummary: (c) => `競合: ${c} 件（同一URLだが表示名やタグが異なるリンク）`,
    conflictChoiceTitle: "競合の解決方法:",
    keepExisting: "既存のリンクを維持する（デフォルト・安全）",
    keepBoth: "両方保持する（新しいリンクIDを発行）",
    confirmImportBtn: "確認してインポート実行",
    importSuccessTitle: "インポートが完了しました",
    importSuccessMsg: (added, skipped, conflicts) =>
      `${added} 件の新しいリンクを追加しました（重複 ${skipped} 件スキップ、競合 ${conflicts} 件処理）。自動安全スナップショットが作成されました。`,
    undoImportBtn: "このインポートを取り消す",
    undoSuccessMsg: "インポートが正常に取り消されました。以前のブックマークデータはそのまま保持されています。",
    revisionConflictTitle: "データ競合が発生しました",
    revisionConflictMsg:
      "この項目は別のタブまたはウィンドウで更新されました。データ保護のため上書きは行われませんでした。再読み込みして最新データを表示してください。",
    saveFailedTitle: "保存に失敗しました",
    saveFailedMsg: "データベースへの保存に失敗しました。入力内容は保持されています。再試行してください。",
    migrationErrorDesc: "旧ストレージのデータ構造に問題があるため、元のデータを変更せず保持しました:",
    undoBlockedTitle: "自動取り消しができません",
    undoBlockedMsg:
      "インポートされた項目が編集されたか、その中に新しい項目が追加されています。データ消失や孤立リンクを防ぐため自動削除を停止しました。インポート前のスナップショットから復元することも可能です（インポート後の変更は破棄されます）。",
    restoreSnapshotConfirmBtn: "インポート前のスナップショットを復元",
    previewStaleNotice: "プレビュー中に別のタブでデータが変更されたため、最新データでプレビューを更新しました。"
  }
};

let currentLang = "en";

export function getLanguage() {
  return currentLang;
}

export function setLanguage(lang) {
  if (translations[lang]) {
    currentLang = lang;
  }
}

export function t(key, ...args) {
  const dict = translations[currentLang] || translations.en;
  const val = dict[key] || translations.en[key] || key;
  if (typeof val === "function") {
    return val(...args);
  }
  return val;
}
