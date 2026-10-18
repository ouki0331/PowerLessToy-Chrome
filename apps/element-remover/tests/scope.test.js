import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUrl,
  isDynamicSegment,
  suggestPathPattern,
  matchScope
} from '../src/common/scope.js';

test('normalizeUrl extracts hostname, pathname, and ignores query/anchors', () => {
  const result = normalizeUrl('https://news.example.com/article/123?from=home#comments');
  assert.equal(result.hostname, 'news.example.com');
  assert.equal(result.pathname, '/article/123');
});

test('normalizeUrl handles client-side hash routes', () => {
  const result1 = normalizeUrl('https://app.example.com/#/dashboard/metrics?view=compact');
  assert.equal(result1.hostname, 'app.example.com');
  assert.equal(result1.pathname, '/dashboard/metrics');

  const result2 = normalizeUrl('https://app.example.com/console/#!/settings/security');
  assert.equal(result2.hostname, 'app.example.com');
  assert.equal(result2.pathname, '/console/settings/security');
});

test('isDynamicSegment identifies IDs, UUIDs, and hashes while preserving semantic tokens', () => {
  // Obvious dynamic
  assert.equal(isDynamicSegment('12345'), true);
  assert.equal(isDynamicSegment('a3f89b12-9c34-4d89-b9f1-9876543210ab'), true);
  assert.equal(isDynamicSegment('6c4176f1624cea848c5b5ffc44ce94f8c6df4833'), true);
  assert.equal(isDynamicSegment('item_x89a12k'), true);

  // Semantic tokens that must NOT be generalized
  assert.equal(isDynamicSegment('2024'), false);
  assert.equal(isDynamicSegment('en'), false);
  assert.equal(isDynamicSegment('settings'), false);
  assert.equal(isDynamicSegment('dashboard'), false);
  assert.equal(isDynamicSegment('article'), false);
  assert.equal(isDynamicSegment('overview'), false);
});

test('suggestPathPattern generalizes dynamic segments into wildcard pattern', () => {
  assert.equal(
    suggestPathPattern('/project/12345/settings'),
    '/project/*/settings'
  );
  assert.equal(
    suggestPathPattern('/user/a3f89b12-9c34-4d89-b9f1-9876543210ab/profile'),
    '/user/*/profile'
  );
  assert.equal(
    suggestPathPattern('/articles/2024/overview'),
    '/articles/2024/overview'
  );
});

test('matchScope matches exact paths, wildcards, and rejects mismatches', () => {
  const rule1 = {
    hostname: 'example.com',
    pathPattern: '/project/*/settings'
  };

  assert.equal(matchScope(rule1, 'https://example.com/project/12345/settings'), true);
  assert.equal(matchScope(rule1, 'https://example.com/project/99999/settings?tab=members'), true);
  assert.equal(matchScope(rule1, 'https://example.com/project/12345/overview'), false);
  assert.equal(matchScope(rule1, 'https://sub.example.com/project/12345/settings'), false);

  const ruleWholeHost = {
    hostname: 'example.com',
    pathPattern: '/*'
  };
  assert.equal(matchScope(ruleWholeHost, 'https://example.com/anywhere/deep'), true);
  assert.equal(matchScope(ruleWholeHost, 'https://other.com/anywhere/deep'), false);
});
