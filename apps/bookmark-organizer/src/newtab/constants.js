/**
 * Constants & Defaults for Bookmark Organizer
 */

export const STORAGE_KEY = "powerless_toy_bookmarks_v1";
export const ACTIVE_CAT_KEY = "powerless_toy_active_category_v1";
export const THEME_MODE_KEY = "powerless_toy_theme_mode";
export const CACHED_GEO_KEY = "powerless_toy_cached_geo";
export const DEFAULT_THEME_MODE = "system";

export const BG_CONFIG_KEY = "powerless_toy_bg_config";
export const BG_CURRENT_KEY = "powerless_toy_bg_current";
export const BG_FAVORITES_KEY = "powerless_toy_bg_favorites";
export const BG_CACHE_KEY = "powerless_toy_bg_cache";
export const BG_DB_NAME = "PowerLessToy_Background_DB";
export const BG_LOCAL_STORE = "local_images";

export const DEFAULT_BADGES = [
  { id: "local", label: "Local", colorClass: "badge-local" },
  { id: "dev", label: "Dev", colorClass: "badge-dev" },
  { id: "test", label: "Test", colorClass: "badge-test" },
  { id: "prod", label: "Prod", colorClass: "badge-prod" }
];

export function getInitialSeedData() {
  const now = Date.now();
  return {
    version: 1,
    categories: [
      {
        id: "cat_work_projects",
        name: "Work Projects",
        description: "Projects and environment links (Local, Dev, Test, Prod)",
        createdAt: now
      },
      {
        id: "cat_company_tools",
        name: "Company Management",
        description: "Portals, GitHub, internal trackers, and admin tools",
        createdAt: now + 1
      },
      {
        id: "cat_tech_interests",
        name: "Tech Interests",
        description: "Framework documentation, reference sites, and research",
        createdAt: now + 2
      }
    ],
    groups: [],
    links: [],
    activeCategoryId: "cat_work_projects"
  };
}
