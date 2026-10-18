/**
 * Element Remover Popup Script (RULE-MANAGE-001, SELECT-PICK-001, STATUS-DEBUG-001).
 */

import { isSupportedUrl } from '../background/index.js';
import { normalizeUrl } from '../common/scope.js';

let activeTab = null;
let pageStatus = null;

async function init() {
  bindGlobalEvents();

  if (typeof chrome === 'undefined' || !chrome.tabs) return;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs[0];
  if (!activeTab || !activeTab.url) {
    showUnsupported('无法读取当前标签页');
    return;
  }

  const supported = isSupportedUrl(activeTab.url);
  if (!supported) {
    showUnsupported('浏览器内部页面、扩展商店或本地受限页面受到安全限制，无法进行元素选取与移除。');
    return;
  }

  await loadPageStatus();
}

function bindGlobalEvents() {
  const btnOptions = document.getElementById('btn-open-options');
  const btnManageAll = document.getElementById('btn-manage-all');
  const openOptions = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  };
  if (btnOptions) btnOptions.onclick = openOptions;
  if (btnManageAll) btnManageAll.onclick = openOptions;

  const btnStartPick = document.getElementById('btn-start-pick');
  if (btnStartPick) {
    btnStartPick.onclick = async () => {
      if (!activeTab || !activeTab.id) return;
      try {
        await chrome.tabs.sendMessage(activeTab.id, { type: 'START_PICKER' });
        window.close(); // Close popup so user can interact with page
      } catch (err) {
        alert('无法连接到当前网页的脚本，请刷新页面后再试。');
      }
    };
  }

  const btnToggleDebug = document.getElementById('btn-toggle-debug');
  if (btnToggleDebug) {
    btnToggleDebug.onclick = async () => {
      if (!activeTab || !activeTab.id || !pageStatus) return;
      const nextState = !pageStatus.debugActive;
      try {
        const res = await chrome.tabs.sendMessage(activeTab.id, {
          type: 'TOGGLE_DEBUG',
          enabled: nextState
        });
        if (res && res.success) {
          pageStatus.debugActive = res.debugActive;
          updateDebugButton(pageStatus.debugActive);
        }
      } catch (err) {
        console.error('Failed to toggle debug:', err);
      }
    };
  }
}

async function loadPageStatus() {
  if (!activeTab || !activeTab.id) return;

  const normalized = normalizeUrl(activeTab.url);
  const subtitleEl = document.getElementById('scope-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `${normalized.hostname} · ${normalized.pathname}`;
    subtitleEl.title = activeTab.url;
  }

  try {
    const res = await chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_STATUS' });
    if (res && res.success) {
      pageStatus = res;
      renderStatus();
    } else {
      renderEmptyState();
    }
  } catch (err) {
    // Content script might not be injected yet or page loading
    renderEmptyState();
  }
}

function showUnsupported(reason) {
  const banner = document.getElementById('unsupported-banner');
  const reasonEl = document.getElementById('unsupported-reason');
  const subtitleEl = document.getElementById('scope-subtitle');
  const btnStartPick = document.getElementById('btn-start-pick');

  if (banner) banner.style.display = 'flex';
  if (reasonEl) reasonEl.textContent = reason;
  if (subtitleEl && activeTab && activeTab.url) {
    subtitleEl.textContent = activeTab.url;
  }
  if (btnStartPick) {
    btnStartPick.disabled = true;
    btnStartPick.title = '受保护页面不支持选择元素';
  }
}

function renderEmptyState() {
  const headlineEl = document.getElementById('summary-headline');
  const breakdownEl = document.getElementById('summary-breakdown');
  const rulesListEl = document.getElementById('rules-list');

  if (headlineEl) headlineEl.textContent = '此页面还没有清理规则';
  if (breakdownEl) breakdownEl.textContent = '点击下方按钮进入网页元素选取模式';
  if (rulesListEl) {
    rulesListEl.innerHTML = '<div class="rules-empty">当前页面暂无已保存的清理规则</div>';
  }
  updateDebugButton(false);
}

function renderStatus() {
  if (!pageStatus) return;

  const { counts, rules, debugActive } = pageStatus;
  const headlineEl = document.getElementById('summary-headline');
  const breakdownEl = document.getElementById('summary-breakdown');
  const rulesListEl = document.getElementById('rules-list');

  if (counts.total > 0) {
    if (headlineEl) headlineEl.textContent = `已处理 ${counts.total} 个元素`;
    if (breakdownEl) {
      breakdownEl.textContent = `${counts.removed} 个已移除 · ${counts.hidden} 个已隐藏`;
    }
  } else {
    if (headlineEl) headlineEl.textContent = '当前未处理任何元素';
    if (breakdownEl) {
      breakdownEl.textContent = rules.length > 0 ? '已配置的规则在当前页面暂未匹配到目标' : '点击下方按钮选取网页元素';
    }
  }

  updateDebugButton(debugActive);

  if (!rulesListEl) return;

  const activeRules = rules.filter(r => r.enabled);
  if (activeRules.length === 0) {
    rulesListEl.innerHTML = '<div class="rules-empty">当前页面没有生效的清理规则</div>';
    return;
  }

  rulesListEl.innerHTML = activeRules.map(rule => {
    const actionText = rule.action === 'hide' ? '隐藏' : '移除';
    const tagClass = rule.action === 'hide' ? 'tag-hide' : 'tag-remove';
    const countText = `${rule.count || 0} 个`;

    return `
      <div class="rule-item">
        <div class="rule-info">
          <div class="rule-name" title="${rule.name}">${rule.name}</div>
          <div class="rule-meta">
            <span class="tag-badge ${tagClass}">${actionText}</span>
            <span>${countText}</span>
            ${rule.status === 'needs_review' ? '<span style="color: #b45309; font-weight: 500;">需要复核</span>' : ''}
          </div>
        </div>
        <button class="btn btn-restore" data-id="${rule.id}">恢复</button>
      </div>
    `;
  }).join('');

  rulesListEl.querySelectorAll('.btn-restore').forEach(btn => {
    btn.onclick = async (e) => {
      const ruleId = e.target.dataset.id;
      if (!ruleId || !activeTab) return;

      btn.disabled = true;
      btn.textContent = '恢复中...';

      try {
        const res = await chrome.tabs.sendMessage(activeTab.id, {
          type: 'RESTORE_RULE',
          ruleId
        });

        if (res && res.requiresReload) {
          if (confirm('目标容器已重建，需要刷新页面才能完全恢复元素。是否立即刷新？\n（我们将尽量保持您的浏览位置）')) {
            await chrome.tabs.reload(activeTab.id);
            window.close();
            return;
          }
        }

        // Reload status in popup
        await loadPageStatus();
      } catch (err) {
        alert('恢复失败: ' + err.message);
        btn.disabled = false;
        btn.textContent = '恢复';
      }
    };
  });
}

function updateDebugButton(active) {
  const btn = document.getElementById('btn-toggle-debug');
  const text = document.getElementById('debug-switch-text');
  if (!btn || !text) return;

  if (active) {
    btn.classList.add('active');
    btn.setAttribute('aria-checked', 'true');
    text.textContent = '开启';
  } else {
    btn.classList.remove('active');
    btn.setAttribute('aria-checked', 'false');
    text.textContent = '关闭';
  }
}

document.addEventListener('DOMContentLoaded', init);
