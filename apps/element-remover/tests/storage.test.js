import test from 'node:test';
import assert from 'node:assert/strict';
import {
  _resetMemoryStore,
  getAllRules,
  getRulesForUrl,
  saveRulesBatch,
  setRuleEnabled,
  batchSetEnabledByScope,
  deleteRule,
  batchDeleteRules
} from '../src/common/storage.js';

test.beforeEach(() => {
  _resetMemoryStore({});
});

test('saveRulesBatch appends rules and skips exact duplicates', async () => {
  const batch1 = [
    {
      hostname: 'example.com',
      pathPattern: '/article/*',
      action: 'remove',
      selector: 'aside.ad-box',
      name: '侧栏广告'
    },
    {
      hostname: 'example.com',
      pathPattern: '/article/*',
      action: 'hide',
      selector: '.recommend-list',
      name: '推荐列表'
    }
  ];

  const res1 = await saveRulesBatch(batch1);
  assert.equal(res1.added.length, 2);
  assert.equal(res1.skipped.length, 0);

  // Second batch with 1 duplicate and 1 new rule
  const batch2 = [
    {
      hostname: 'example.com',
      pathPattern: '/article/*',
      action: 'remove',
      selector: 'aside.ad-box', // duplicate
      name: '侧栏广告'
    },
    {
      hostname: 'example.com',
      pathPattern: '/article/*',
      action: 'remove',
      selector: '.banner-bottom', // new
      name: '底部横幅'
    }
  ];

  const res2 = await saveRulesBatch(batch2);
  assert.equal(res2.added.length, 1);
  assert.equal(res2.skipped.length, 1);

  const allRules = await getAllRules();
  assert.equal(allRules.length, 3);
  assert.equal(allRules[0].name, '侧栏广告');
  assert.equal(allRules[1].name, '推荐列表');
  assert.equal(allRules[2].name, '底部横幅');
});

test('getRulesForUrl returns only rules matching the current URL scope', async () => {
  await saveRulesBatch([
    {
      hostname: 'example.com',
      pathPattern: '/article/*',
      action: 'remove',
      selector: '.ad'
    },
    {
      hostname: 'example.com',
      pathPattern: '/news/*',
      action: 'hide',
      selector: '.popup'
    },
    {
      hostname: 'other.org',
      pathPattern: '/*',
      action: 'remove',
      selector: '.notice'
    }
  ]);

  const matched = await getRulesForUrl('https://example.com/article/100?tab=view');
  assert.equal(matched.length, 1);
  assert.equal(matched[0].selector, '.ad');
});

test('setRuleEnabled disables a rule without deleting it', async () => {
  const { added } = await saveRulesBatch([
    {
      hostname: 'example.com',
      pathPattern: '/*',
      action: 'remove',
      selector: '#sidebar'
    }
  ]);

  const ruleId = added[0].id;
  assert.equal(added[0].enabled, true);

  // Restore/disable rule
  const updated = await setRuleEnabled(ruleId, false);
  assert.equal(updated.enabled, false);

  const rulesAfter = await getAllRules();
  assert.equal(rulesAfter.length, 1);
  assert.equal(rulesAfter[0].enabled, false);

  // Re-enable rule
  await setRuleEnabled(ruleId, true);
  const rulesReenabled = await getAllRules();
  assert.equal(rulesReenabled[0].enabled, true);
});

test('batchSetEnabledByScope disables all rules under a path or hostname', async () => {
  await saveRulesBatch([
    { hostname: 'example.com', pathPattern: '/article/*', action: 'remove', selector: '.a' },
    { hostname: 'example.com', pathPattern: '/article/*', action: 'hide', selector: '.b' },
    { hostname: 'example.com', pathPattern: '/news/*', action: 'remove', selector: '.c' }
  ]);

  // Disable by path
  await batchSetEnabledByScope({ hostname: 'example.com', pathPattern: '/article/*' }, false);

  const rules = await getAllRules();
  assert.equal(rules.find(r => r.selector === '.a').enabled, false);
  assert.equal(rules.find(r => r.selector === '.b').enabled, false);
  assert.equal(rules.find(r => r.selector === '.c').enabled, true);

  // Disable whole hostname
  await batchSetEnabledByScope({ hostname: 'example.com' }, false);
  const allRules = await getAllRules();
  assert.ok(allRules.every(r => r.enabled === false));
});

test('deleteRule permanently removes rule', async () => {
  const { added } = await saveRulesBatch([
    { hostname: 'example.com', pathPattern: '/*', action: 'remove', selector: '.ad' },
    { hostname: 'example.com', pathPattern: '/*', action: 'hide', selector: '.promo' }
  ]);

  const deleted = await deleteRule(added[0].id);
  assert.equal(deleted, true);

  const remaining = await getAllRules();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].selector, '.promo');
});

test('batchDeleteRules deletes multiple rules and returns deleted count', async () => {
  const { added } = await saveRulesBatch([
    { hostname: 'example.com', pathPattern: '/*', action: 'remove', selector: '.1' },
    { hostname: 'example.com', pathPattern: '/*', action: 'remove', selector: '.2' },
    { hostname: 'example.com', pathPattern: '/*', action: 'remove', selector: '.3' }
  ]);

  const count = await batchDeleteRules([added[0].id, added[2].id]);
  assert.equal(count, 2);

  const remaining = await getAllRules();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].selector, '.2');
});
