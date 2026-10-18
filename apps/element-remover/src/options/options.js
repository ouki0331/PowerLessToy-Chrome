/**
 * Element Remover Options Page Logic (RULE-MANAGE-002).
 */

import {
  getAllRules,
  setRuleEnabled,
  batchSetEnabledByScope,
  deleteRule
} from '../common/storage.js';

let allRules = [];
let searchQuery = '';
let activeFilter = 'all'; // 'all' | 'review' | 'disabled'
const collapsedHosts = new Set();

async function init() {
  bindControls();
  await loadAndRender();
}

function bindControls() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      render();
    };
  }

  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.onclick = () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      render();
    };
  });
}

async function loadAndRender() {
  try {
    allRules = await getAllRules();
    render();
  } catch (err) {
    alert('加载规则数据失败: ' + err.message);
  }
}

function filterRules(rules) {
  return rules.filter(r => {
    // Search query filter
    if (searchQuery) {
      const matchHost = r.hostname.includes(searchQuery);
      const matchPath = (r.pathPattern || '').toLowerCase().includes(searchQuery);
      const matchName = (r.name || '').toLowerCase().includes(searchQuery);
      const matchSel = (r.selector || '').toLowerCase().includes(searchQuery);
      if (!matchHost && !matchPath && !matchName && !matchSel) return false;
    }

    // Status tab filter
    if (activeFilter === 'review') {
      return r.status === 'needs_review';
    }
    if (activeFilter === 'disabled') {
      return !r.enabled;
    }

    return true;
  });
}

function groupRules(rules) {
  const hostMap = new Map();

  for (const r of rules) {
    const host = r.hostname;
    if (!hostMap.has(host)) {
      hostMap.set(host, new Map());
    }
    const pathMap = hostMap.get(host);
    const path = r.pathPattern || '/*';
    if (!pathMap.has(path)) {
      pathMap.set(path, []);
    }
    pathMap.get(path).push(r);
  }

  return hostMap;
}

function render() {
  const treeEl = document.getElementById('rules-tree');
  const emptyEl = document.getElementById('empty-state');
  const statsEl = document.getElementById('stats-summary');

  const filtered = filterRules(allRules);
  const hostMap = groupRules(filtered);

  // Update top stats summary
  if (statsEl) {
    const totalHosts = new Set(allRules.map(r => r.hostname)).size;
    const activeCount = allRules.filter(r => r.enabled).length;
    statsEl.textContent = `${totalHosts} 个网站 · ${allRules.length} 条规则 (${activeCount} 条启用)`;
  }

  if (allRules.length === 0 || hostMap.size === 0) {
    if (treeEl) treeEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (!treeEl) return;

  let html = '';

  for (const [hostname, pathMap] of hostMap.entries()) {
    const isCollapsed = collapsedHosts.has(hostname);
    let hostTotal = 0;
    let hostActive = 0;
    let hostReview = 0;

    for (const rules of pathMap.values()) {
      hostTotal += rules.length;
      hostActive += rules.filter(r => r.enabled).length;
      hostReview += rules.filter(r => r.status === 'needs_review').length;
    }

    html += `
      <div class="host-group ${isCollapsed ? 'collapsed' : ''}" data-host="${hostname}">
        <div class="host-header" data-toggle-host="${hostname}">
          <div class="host-info">
            <svg class="toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
            <span class="host-name">${hostname}</span>
            <div class="host-meta">
              <span>${hostTotal} 条规则</span>
              ${hostActive < hostTotal ? `<span style="color: var(--text-muted);">(${hostTotal - hostActive} 条已停用)</span>` : ''}
              ${hostReview > 0 ? `<span style="color: #b45309; font-weight: 500;">(${hostReview} 条需复核)</span>` : ''}
            </div>
          </div>
          <div class="host-actions" onclick="event.stopPropagation()">
            <button class="btn btn-ghost btn-restore-host" data-host="${hostname}" title="停用该网站下的所有规则">
              恢复网站
            </button>
          </div>
        </div>

        <div class="host-content">
          ${Array.from(pathMap.entries()).map(([path, rules]) => `
            <div class="path-subgroup">
              <div class="path-header">
                <span class="path-pattern">
                  ${path.replace(/\*/g, '<span class="path-wildcard">*</span>')}
                </span>
                <button class="btn btn-ghost btn-restore-path" data-host="${hostname}" data-path="${path}" title="停用该路径下的所有规则">
                  恢复路径
                </button>
              </div>

              <div class="rules-list">
                ${rules.map(rule => {
                  const actionText = rule.action === 'hide' ? '隐藏' : '移除';
                  const actionClass = rule.action === 'hide' ? 'badge-hide' : 'badge-remove';
                  let statusBadge = '<span class="badge badge-exact">精确</span>';

                  if (!rule.enabled) {
                    statusBadge = '<span class="badge badge-disabled">已停用</span>';
                  } else if (rule.status === 'needs_review') {
                    statusBadge = '<span class="badge badge-review">需要复核</span>';
                  }

                  return `
                    <div class="rule-row">
                      <div class="rule-main">
                        <span class="badge ${actionClass}">${actionText}</span>
                        <span class="rule-title" title="${rule.name}">${rule.name}</span>
                        <span class="rule-selector" title="${rule.selector}">${rule.selector}</span>
                        ${statusBadge}
                      </div>
                      <div class="rule-controls">
                        <button class="btn btn-toggle-rule" data-id="${rule.id}">
                          ${rule.enabled ? '停用' : '启用'}
                        </button>
                        <button class="btn btn-danger btn-delete-rule" data-id="${rule.id}" data-name="${rule.name}">
                          删除
                        </button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  treeEl.innerHTML = html;
  bindTreeEvents();
}

function bindTreeEvents() {
  const treeEl = document.getElementById('rules-tree');
  if (!treeEl) return;

  // Toggle collapse host
  treeEl.querySelectorAll('[data-toggle-host]').forEach(el => {
    el.onclick = () => {
      const host = el.dataset.toggleHost;
      if (collapsedHosts.has(host)) collapsedHosts.delete(host);
      else collapsedHosts.add(host);
      render();
    };
  });

  // Batch restore host (disable all)
  treeEl.querySelectorAll('.btn-restore-host').forEach(btn => {
    btn.onclick = async () => {
      const host = btn.dataset.host;
      if (!host) return;
      await batchSetEnabledByScope({ hostname: host }, false);
      await loadAndRender();
    };
  });

  // Batch restore path (disable all)
  treeEl.querySelectorAll('.btn-restore-path').forEach(btn => {
    btn.onclick = async () => {
      const host = btn.dataset.host;
      const path = btn.dataset.path;
      if (!host || !path) return;
      await batchSetEnabledByScope({ hostname: host, pathPattern: path }, false);
      await loadAndRender();
    };
  });

  // Toggle single rule
  treeEl.querySelectorAll('.btn-toggle-rule').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const rule = allRules.find(r => r.id === id);
      if (!rule) return;
      await setRuleEnabled(id, !rule.enabled);
      await loadAndRender();
    };
  });

  // Delete single rule
  treeEl.querySelectorAll('.btn-delete-rule').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const name = btn.dataset.name || '此规则';
      showDeleteConfirmation(id, name);
    };
  });
}

function showDeleteConfirmation(ruleId, ruleName) {
  const container = document.getElementById('modal-container');
  if (!container) return;

  container.innerHTML = `
    <div class="modal-overlay" id="confirm-modal-backdrop">
      <div class="modal-dialog">
        <h3 class="modal-title">永久删除规则</h3>
        <p class="modal-body">
          确定要永久删除规则 <strong>${ruleName}</strong> 吗？<br>
          删除后该规则将从本地存储彻底移除，相关页面元素将恢复原始展示。此操作无法撤销。
        </p>
        <div class="modal-actions">
          <button class="btn" id="btn-cancel-delete">取消</button>
          <button class="btn btn-primary" id="btn-confirm-delete" style="background-color: var(--danger-primary); border-color: var(--danger-primary);">
            永久删除
          </button>
        </div>
      </div>
    </div>
  `;

  const close = () => { container.innerHTML = ''; };
  container.querySelector('#btn-cancel-delete').onclick = close;
  container.querySelector('#confirm-modal-backdrop').onclick = (e) => {
    if (e.target.id === 'confirm-modal-backdrop') close();
  };

  container.querySelector('#btn-confirm-delete').onclick = async () => {
    await deleteRule(ruleId);
    close();
    await loadAndRender();
  };
}

document.addEventListener('DOMContentLoaded', init);
