/**
 * Scope matching and URL normalization for Element Remover (RULE-SCOPE-001).
 */

const STATIC_SEMANTIC_SEGMENTS = new Set([
  'settings', 'setting', 'admin', 'dashboard', 'overview', 'profile', 'members',
  'article', 'articles', 'post', 'posts', 'view', 'edit', 'new', 'index',
  'login', 'logout', 'signup', 'register', 'home', 'about', 'contact',
  'api', 'v1', 'v2', 'v3', 'static', 'assets', 'help', 'docs'
]);

/**
 * Normalizes URL into standard hostname, path, and client-side SPA routing components.
 * Ignores query parameters and standard anchor fragments.
 * Handles client-side hash routes (#/route or #!/route) as path segments.
 *
 * @param {string} rawUrl
 * @returns {{ hostname: string, pathname: string, fullPath: string }}
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { hostname: '', pathname: '/', fullPath: '/' };
  }

  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    let pathname = parsed.pathname || '/';

    // Check for client-side routing in hash: #/route or #!/route
    const hash = parsed.hash || '';
    if (hash.startsWith('#/') || hash.startsWith('#!/')) {
      const cleanHashPath = hash.replace(/^#!?/, '');
      const hashWithoutQuery = cleanHashPath.split('?')[0].split('#')[0];
      pathname = pathname.replace(/\/+$/, '') + '/' + hashWithoutQuery.replace(/^\/+/, '');
    }

    // Normalize multiple slashes and trailing slashes
    pathname = pathname.replace(/\/+/g, '/');
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    return {
      hostname,
      pathname,
      fullPath: pathname
    };
  } catch {
    return { hostname: '', pathname: '/', fullPath: '/' };
  }
}

/**
 * Checks whether a path segment is an obvious dynamic parameter.
 * Dynamic: numeric IDs (12345), UUIDs, long hex hashes, or high-entropy alphanumeric tokens.
 * Semantic: Years (2024), 2-letter language codes (en, zh), or fixed semantic terms are NOT dynamic.
 *
 * @param {string} segment
 * @returns {boolean}
 */
export function isDynamicSegment(segment) {
  if (!segment) return false;
  const lower = segment.toLowerCase();

  // Explicit static semantic words
  if (STATIC_SEMANTIC_SEGMENTS.has(lower)) return false;

  // Years (e.g., 1990 - 2099)
  if (/^(19|20)\d{2}$/.test(segment)) return false;

  // Language / locale codes (en, zh, en-US, ja-JP)
  if (/^[a-z]{2}(-[a-z]{2,4})?$/i.test(segment)) return false;

  // Obvious numeric ID (e.g. 12345, 987654321)
  if (/^\d{3,}$/.test(segment)) return true;

  // UUID (e.g., 123e4567-e89b-12d3-a456-426614174000)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
    return true;
  }

  // Hex hash (e.g., git commit hash, sha, md5)
  if (/^[0-9a-f]{12,}$/i.test(segment)) return true;

  // High-entropy random alphanumeric token (>= 8 chars with mixed digits and letters)
  if (segment.length >= 8 && /\d/.test(segment) && /[a-zA-Z]/.test(segment)) {
    return true;
  }

  return false;
}

/**
 * Suggests a generalized path pattern for obvious dynamic segments.
 *
 * @param {string} pathname
 * @returns {string} Suggested pattern, e.g. "/project/{wildcard}/settings"
 */
export function suggestPathPattern(pathname) {
  if (!pathname || pathname === '/') return '/*';

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return '/*';

  let hasDynamic = false;
  const generalizedSegments = segments.map(seg => {
    if (isDynamicSegment(seg)) {
      hasDynamic = true;
      return '*';
    }
    return seg;
  });

  const basePattern = '/' + generalizedSegments.join('/');
  return hasDynamic ? basePattern : basePattern;
}

/**
 * Converts a path pattern containing '*' wildcards into a regular expression.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
export function patternToRegExp(pattern) {
  if (!pattern || pattern === '/*' || pattern === '*') {
    return /^.*$/;
  }

  // Escape special regex characters except '*'
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]+');

  return new RegExp(`^${escaped}(?:/.*)?$`, 'i');
}

/**
 * Matches a current URL against a rule's scope.
 *
 * @param {{ hostname: string, pathPattern: string, scopeType?: string }} ruleScope
 * @param {string} currentUrl
 * @returns {boolean}
 */
export function matchScope(ruleScope, currentUrl) {
  if (!ruleScope || !ruleScope.hostname || !currentUrl) return false;

  const current = normalizeUrl(currentUrl);
  if (!current.hostname) return false;

  // Exact hostname match (no wildcard expansion to sibling subdomains)
  if (ruleScope.hostname.toLowerCase() !== current.hostname) {
    return false;
  }

  const pathPattern = ruleScope.pathPattern || '/*';

  // If pattern is wildcard for whole host
  if (pathPattern === '/*' || pathPattern === '*') {
    return true;
  }

  // Normalize path pattern
  let cleanPattern = pathPattern.replace(/\/+/g, '/');
  if (cleanPattern.length > 1 && cleanPattern.endsWith('/')) {
    cleanPattern = cleanPattern.slice(0, -1);
  }

  // Check exact path match
  if (!cleanPattern.includes('*')) {
    return cleanPattern === current.pathname;
  }

  // Wildcard match
  const regex = patternToRegExp(cleanPattern);
  return regex.test(current.pathname);
}
