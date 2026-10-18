/**
 * Selector generation, fingerprinting, and stability evaluation for Element Remover (RULE-MATCH-001).
 */

const DYNAMIC_ID_PATTERN = /(:r\w+:|\d{4,}|[a-f0-9]{8,}|ember\d+|react-\d+|vue-\d+|ng-\d+)/i;
const HASHED_CLASS_PATTERN = /^([a-z0-9_-]{1,2}|css-[a-z0-9]+|jsx-\d+|sc-[a-z0-9]+|_[a-zA-Z0-9]{5,}|[a-zA-Z0-9]{20,})$/i;
const SEMANTIC_ATTRIBUTES = ['data-testid', 'data-component', 'data-qa', 'data-element', 'aria-label', 'role'];

const escapeCss = (str) => {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(str);
  }
  return String(str).replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
};

/**
 * Checks whether an element's ID is likely stable and non-generated.
 *
 * @param {string} id
 * @returns {boolean}
 */
export function isStableId(id) {
  if (!id || typeof id !== 'string') return false;
  if (DYNAMIC_ID_PATTERN.test(id)) return false;
  // Must be valid CSS identifier
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id);
}

/**
 * Filters out framework-generated or hashed CSS class names.
 *
 * @param {string} className
 * @returns {boolean}
 */
export function isMeaningfulClass(className) {
  if (!className || typeof className !== 'string') return false;
  if (HASHED_CLASS_PATTERN.test(className)) return false;
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(className);
}

/**
 * Extracts a human-friendly name for an element.
 *
 * @param {Element} element
 * @returns {string}
 */
export function getElementFriendlyName(element) {
  if (!element || !element.tagName) return '未知元素';

  const tag = element.tagName.toLowerCase();

  // Check aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) {
    return `${tag} · ${ariaLabel.trim().slice(0, 20)}`;
  }

  // Check data-testid or role
  const testId = element.getAttribute('data-testid') || element.getAttribute('data-component');
  if (testId) {
    return `${tag} · ${testId.slice(0, 20)}`;
  }

  // Check role
  const role = element.getAttribute('role');
  if (role) {
    return `${tag} · ${role}`;
  }

  // Check meaningful class names
  if (element.classList && element.classList.length > 0) {
    const validClass = Array.from(element.classList).find(isMeaningfulClass);
    if (validClass) {
      return `${tag}.${validClass}`;
    }
  }

  // Check text content preview
  const text = (element.textContent || '').trim().replace(/\s+/g, ' ');
  if (text.length > 0 && text.length <= 25) {
    return `${tag} · ${text}`;
  } else if (text.length > 25) {
    return `${tag} · ${text.slice(0, 20)}...`;
  }

  return tag;
}

/**
 * Generates an element fingerprint for re-verification.
 *
 * @param {Element} element
 * @param {number} expectedCount
 * @returns {{ tag: string, textPreview: string, expectedCount: number }}
 */
export function generateFingerprint(element, expectedCount = 1) {
  const tag = element ? element.tagName.toLowerCase() : '';
  const text = element ? (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) : '';
  return {
    tag,
    textPreview: text,
    expectedCount: Math.max(1, expectedCount)
  };
}

/**
 * Generates a stable, unique CSS selector for a target element.
 * Prioritizes stable IDs, semantic attributes, semantic tags, and meaningful classes.
 * Strictly avoids position indices (nth-child, nth-of-type) as preferred selectors (RULE-MATCH-001).
 *
 * @param {Element} element
 * @param {Document|Element} root
 * @returns {string}
 */
export function generateStableSelector(element, root = document) {
  if (!element || !element.tagName) return '';

  const tag = element.tagName.toLowerCase();

  // 1. Direct stable ID
  if (element.id && isStableId(element.id)) {
    const idSelector = `#${escapeCss(element.id)}`;
    if (root.querySelectorAll(idSelector).length === 1) {
      return idSelector;
    }
  }

  // 2. Semantic attributes on the element itself
  for (const attr of SEMANTIC_ATTRIBUTES) {
    const val = element.getAttribute(attr);
    if (val && !DYNAMIC_ID_PATTERN.test(val)) {
      const attrSelector = `${tag}[${attr}="${escapeCss(val)}"]`;
      if (root.querySelectorAll(attrSelector).length === 1) {
        return attrSelector;
      }
    }
  }

  // 3. Meaningful classes on the element itself
  if (element.classList && element.classList.length > 0) {
    const goodClasses = Array.from(element.classList).filter(isMeaningfulClass);
    if (goodClasses.length > 0) {
      const classSelector = `${tag}.${goodClasses.map(c => escapeCss(c)).join('.')}`;
      if (root.querySelectorAll(classSelector).length === 1) {
        return classSelector;
      }
    }
  }

  // 4. Climb ancestors to find unique hierarchical selector without position indices
  let current = element;
  const pathParts = [];
  let depth = 0;

  while (current && current !== root && current.nodeType === 1 && depth < 5) {
    const curTag = current.tagName.toLowerCase();
    let segment = curTag;

    // Check if ancestor has stable ID
    if (current.id && isStableId(current.id)) {
      pathParts.unshift(`#${escapeCss(current.id)}`);
      break;
    }

    // Check ancestor semantic test id
    const testId = current.getAttribute('data-testid');
    if (testId && !DYNAMIC_ID_PATTERN.test(testId)) {
      segment = `${curTag}[data-testid="${escapeCss(testId)}"]`;
    } else if (current.classList && current.classList.length > 0) {
      const bestClass = Array.from(current.classList).find(isMeaningfulClass);
      if (bestClass) {
        segment = `${curTag}.${escapeCss(bestClass)}`;
      }
    }

    pathParts.unshift(segment);
    const candidate = pathParts.join(' > ');
    try {
      if (root.querySelectorAll(candidate).length === 1) {
        return candidate;
      }
    } catch {
      // Ignore querySelector syntax error and continue climbing
    }

    current = current.parentElement;
    depth++;
  }

  // If still not uniquely identified, use ancestor descendant combination
  if (pathParts.length > 0) {
    return pathParts.join(' > ');
  }

  return tag;
}

/**
 * Evaluates the reliability status of a selector against the current document (RULE-MATCH-001).
 *
 * @param {string} selector
 * @param {{ expectedCount?: number, tag?: string, textPreview?: string }} fingerprint
 * @param {Document|Element} root
 * @returns {{ status: 'exact'|'needs_review'|'not_matched'|'possible_variance', count: number, elements: Array<Element> }}
 */
export function evaluateSelectorReliability(selector, fingerprint = {}, root = document) {
  if (!selector) {
    return { status: 'not_matched', count: 0, elements: [] };
  }

  let elements = [];
  try {
    elements = Array.from(root.querySelectorAll(selector));
  } catch {
    return { status: 'not_matched', count: 0, elements: [] };
  }

  const count = elements.length;
  const expectedCount = fingerprint.expectedCount || 1;

  if (count === 0) {
    return { status: 'not_matched', count: 0, elements: [] };
  }

  // Expected 1, found 1
  if (expectedCount === 1 && count === 1) {
    // Check fingerprint consistency if provided
    const elem = elements[0];
    if (fingerprint.tag && elem.tagName.toLowerCase() !== fingerprint.tag.toLowerCase()) {
      return { status: 'needs_review', count, elements };
    }
    return { status: 'exact', count: 1, elements };
  }

  // Expected 1, but found multiple: AMBIGUITY! Pause execution!
  if (expectedCount === 1 && count > 1) {
    return { status: 'needs_review', count, elements };
  }

  // Expected multiple and found within reasonable range
  if (expectedCount > 1 && count > 0) {
    return { status: 'exact', count, elements };
  }

  return { status: 'possible_variance', count, elements };
}
