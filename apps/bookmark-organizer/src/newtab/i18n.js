/**
 * Internationalization (i18n) for Bookmark Organizer
 * Supports English and Japanese. Zero Chinese text.
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
    openNewTabHint: "Click to open in current tab. Ctrl/Cmd+Click to open in new tab."
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
    openNewTabHint: "クリックで現在のタブで開きます。Ctrl/Cmd+クリックで新しいタブで開きます。"
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
