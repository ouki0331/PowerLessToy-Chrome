import test from 'node:test';
import assert from 'node:assert/strict';
import { DomEngine } from '../src/content/dom-engine.js';

// Mock DOM elements and document for Node.js test environment
function createMockDoc() {
  const elements = [];

  class MockNode {
    constructor(type, name) {
      this.nodeType = type; // 1 = element, 8 = comment
      this.nodeName = name;
      this.parentNode = null;
      this.children = [];
      this.attributes = {};
      this.style = {
        _props: {},
        setProperty(k, v) { this._props[k] = v; },
        removeProperty(k) { delete this._props[k]; }
      };
      this.__elementRemoverProcessed = null;
    }

    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] || null; }
    hasAttribute(k) { return k in this.attributes; }
    removeAttribute(k) { delete this.attributes[k]; }

    appendChild(node) {
      return this.insertBefore(node, null);
    }

    insertBefore(newNode, refNode) {
      newNode.parentNode = this;
      const idx = this.children.indexOf(refNode);
      if (idx !== -1) {
        this.children.splice(idx, 0, newNode);
      } else {
        this.children.push(newNode);
      }
      return newNode;
    }

    removeChild(node) {
      const idx = this.children.indexOf(node);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        node.parentNode = null;
      }
      return node;
    }

    remove() {
      if (this.parentNode) {
        this.parentNode.removeChild(this);
      }
    }
  }

  const root = new MockNode(1, 'BODY');

  const doc = {
    body: root,
    head: new MockNode(1, 'HEAD'),
    createElement(tag) {
      const el = new MockNode(1, tag.toUpperCase());
      el.tagName = tag.toUpperCase();
      elements.push(el);
      return el;
    },
    createComment(text) {
      return new MockNode(8, '#comment');
    },
    querySelectorAll(selector) {
      return elements.filter(el => {
        if (!el.parentNode) return false;
        if (selector === el.tagName.toLowerCase()) return true;
        if (selector.startsWith('.') && el.getAttribute('class') === selector.slice(1)) return true;
        if (selector.startsWith('#') && el.getAttribute('id') === selector.slice(1)) return true;
        return false;
      });
    }
  };

  return { doc, root, elements };
}

test('DomEngine: hide keeps element in DOM and applies hidden styling', () => {
  const { doc, root } = createMockDoc();
  const target = doc.createElement('aside');
  target.setAttribute('class', 'ad-box');
  root.insertBefore(target, null);

  const engine = new DomEngine(doc);
  const rule = {
    id: 'r1',
    selector: '.ad-box',
    action: 'hide',
    enabled: true,
    fingerprint: { expectedCount: 1, tag: 'aside' }
  };

  engine.init([rule]);

  // Target still has parent (remains in DOM)
  assert.equal(target.parentNode, root);
  assert.equal(target.hasAttribute('data-element-remover-hidden'), true);
  assert.equal(target.style._props['display'], 'none');

  const counts = engine.getActiveCounts();
  assert.equal(counts.total, 1);
  assert.equal(counts.hidden, 1);
  assert.equal(counts.removed, 0);

  // In-situ restore
  const restoreRes = engine.restoreRule('r1');
  assert.equal(restoreRes.success, true);
  assert.equal(restoreRes.restoredCount, 1);
  assert.equal(target.hasAttribute('data-element-remover-hidden'), false);
  assert.equal(target.style._props['display'], undefined);
  assert.equal(engine.getActiveCounts().total, 0);
});

test('DomEngine: remove removes element and creates anchor; in-situ restore re-inserts node', () => {
  const { doc, root } = createMockDoc();
  const target = doc.createElement('div');
  target.setAttribute('id', 'banner');
  root.insertBefore(target, null);

  const engine = new DomEngine(doc);
  const rule = {
    id: 'r2',
    selector: '#banner',
    action: 'remove',
    enabled: true,
    fingerprint: { expectedCount: 1, tag: 'div' }
  };

  engine.init([rule]);

  // Target was removed from parent
  assert.equal(target.parentNode, null);
  // Anchor comment is in parent
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].nodeType, 8); // comment node

  const counts = engine.getActiveCounts();
  assert.equal(counts.total, 1);
  assert.equal(counts.removed, 1);

  // In-situ restore: puts target back and deletes anchor
  const restoreRes = engine.restoreRule('r2');
  assert.equal(restoreRes.success, true);
  assert.equal(restoreRes.restoredCount, 1);
  assert.equal(target.parentNode, root);
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0], target);
  assert.equal(engine.getActiveCounts().total, 0);
});

test('DomEngine: safely suspends rule if multiple elements match expected 1 (RULE-MATCH-001)', () => {
  const { doc, root } = createMockDoc();
  const el1 = doc.createElement('div');
  el1.setAttribute('class', 'ambiguous-promo');
  root.insertBefore(el1, null);

  const el2 = doc.createElement('div');
  el2.setAttribute('class', 'ambiguous-promo');
  root.insertBefore(el2, null);

  const engine = new DomEngine(doc);
  const rule = {
    id: 'r3',
    selector: '.ambiguous-promo',
    action: 'remove',
    enabled: true,
    fingerprint: { expectedCount: 1, tag: 'div' }
  };

  engine.init([rule]);

  // Rule was suspended! Neither el1 nor el2 removed!
  assert.equal(rule.status, 'needs_review');
  assert.equal(el1.parentNode, root);
  assert.equal(el2.parentNode, root);
  assert.equal(engine.getActiveCounts().total, 0);
});
