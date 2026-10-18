/**
 * Element Picker Overlay (SELECT-PICK-001, ACTION-APPLY-001, RULE-SCOPE-001).
 * Operates inside an isolated Shadow DOM container.
 */

import {
  generateStableSelector,
  getElementFriendlyName,
  generateFingerprint
} from './selector.js';
import { suggestPathPattern, normalizeUrl } from '../common/scope.js';
import { saveRulesBatch } from '../common/storage.js';

export class PickerOverlay {
  constructor(documentRef = document) {
    this.doc = documentRef;
    this.host = null;
    this.shadow = null;
    this.active = false;
    this.previewMode = false;

    // Array of selected items: { id, element, selector, name, action, fingerprint }
    this.selectedItems = [];
    this.hoveredElement = null;
    this.defaultAction = 'remove';

    this.onFinish = null;

    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  /**
   * Starts element picker mode.
   */
  start(onFinish = null) {
    if (this.active) return;
    this.active = true;
    this.onFinish = onFinish;
    this.selectedItems = [];
    this.previewMode = false;
    this.hoveredElement = null;

    this.setupShadowDom();
    this.attachEventListeners();
    this.render();
  }

  /**
   * Stops element picker mode and cleans up.
   */
  stop() {
    if (!this.active) return;
    this.active = false;
    this.detachEventListeners();
    this.exitPreview();

    if (this.host && this.host.parentNode) {
      this.host.remove();
    }
    this.host = null;
    this.shadow = null;
    this.selectedItems = [];

    if (typeof this.onFinish === 'function') {
      this.onFinish();
    }
  }

  setupShadowDom() {
    this.host = this.doc.createElement('div');
    this.host.id = 'element-remover-picker-root';
    this.host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; z-index: 2147483640; pointer-events: none;';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.doc.documentElement.appendChild(this.host);
  }

  attachEventListeners() {
    this.doc.addEventListener('pointermove', this.handlePointerMove, true);
    this.doc.addEventListener('click', this.handleClick, true);
    this.doc.addEventListener('keydown', this.handleKeyDown, true);
  }

  detachEventListeners() {
    this.doc.removeEventListener('pointermove', this.handlePointerMove, true);
    this.doc.removeEventListener('click', this.handleClick, true);
    this.doc.removeEventListener('keydown', this.handleKeyDown, true);
  }

  handlePointerMove(e) {
    if (!this.active || this.previewMode) return;

    // Ignore events inside our toolbar/modals
    const target = e.target;
    if (!target || target === this.host || (this.host && this.host.contains(target))) {
      return;
    }

    if (target !== this.hoveredElement) {
      this.hoveredElement = target;
      this.render();
    }
  }

  handleClick(e) {
    if (!this.active || this.previewMode) return;

    // Check if click was on our toolbar/shadow UI
    if (e.composedPath && e.composedPath().some(el => el === this.host)) {
      return;
    }

    const target = e.target;
    if (!target || target === this.host) return;

    e.preventDefault();
    e.stopPropagation();

    // Check if target is already selected
    const existingIndex = this.selectedItems.findIndex(item => item.element === target);
    if (existingIndex !== -1) {
      // Toggle off / deselect
      this.selectedItems.splice(existingIndex, 1);
    } else {
      // Add target to selection (DEC-002, DEC-003: no auto-expanding to parent)
      const selector = generateStableSelector(target, this.doc);
      const name = getElementFriendlyName(target);
      const fingerprint = generateFingerprint(target, 1);

      this.selectedItems.push({
        id: `sel_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        element: target,
        selector,
        name,
        action: this.defaultAction,
        fingerprint
      });
    }

    this.render();
  }

  handleKeyDown(e) {
    if (!this.active) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.previewMode) {
        this.exitPreview();
      } else if (this.selectedItems.length > 0) {
        if (confirm('您有未保存的选定元素，确定要退出选择模式吗？')) {
          this.stop();
        }
      } else {
        this.stop();
      }
    }
  }

  enterPreview() {
    this.previewMode = true;
    for (const item of this.selectedItems) {
      if (item.element) {
        if (item.action === 'hide') {
          item.element.style.setProperty('display', 'none', 'important');
        } else {
          item.element.style.setProperty('visibility', 'hidden', 'important');
        }
      }
    }
    this.render();
  }

  exitPreview() {
    this.previewMode = false;
    for (const item of this.selectedItems) {
      if (item.element) {
        item.element.style.removeProperty('display');
        item.element.style.removeProperty('visibility');
      }
    }
    this.render();
  }

  checkParentChildContainment() {
    const warnings = [];
    for (let i = 0; i < this.selectedItems.length; i++) {
      for (let j = 0; j < this.selectedItems.length; j++) {
        if (i !== j) {
          const a = this.selectedItems[i].element;
          const b = this.selectedItems[j].element;
          if (b && a && b.contains(a)) {
            warnings.push(`目标 #${i + 1} 位于目标 #${j + 1} 内部，已分别保留选择`);
          }
        }
      }
    }
    return warnings;
  }

  async saveRules(scopePattern, scopeType) {
    const normalized = normalizeUrl(window.location.href);
    const newRules = this.selectedItems.map(item => ({
      hostname: normalized.hostname,
      pathPattern: scopePattern,
      scopeType: scopeType,
      name: item.name,
      action: item.action,
      selector: item.selector,
      fingerprint: item.fingerprint,
      enabled: true
    }));

    try {
      const result = await saveRulesBatch(newRules);
      this.exitPreview();
      this.stop();
      return result;
    } catch (err) {
      alert(`保存规则失败: ${err.message}`);
      return null;
    }
  }

  render() {
    if (!this.shadow) return;

    // Collect highlights
    let highlightsHtml = '';
    const scrollX = window.scrollX || 0;
    const scrollY = window.scrollY || 0;

    // Hovered candidate highlight
    if (!this.previewMode && this.hoveredElement && !this.selectedItems.some(i => i.element === this.hoveredElement)) {
      const rect = this.hoveredElement.getBoundingClientRect();
      highlightsHtml += `
        <div class="candidate-box" style="
          top: ${rect.top + scrollY}px;
          left: ${rect.left + scrollX}px;
          width: ${Math.max(rect.width, 24)}px;
          height: ${Math.max(rect.height, 24)}px;
        ">
          <span class="candidate-tag">${getElementFriendlyName(this.hoveredElement)}</span>
        </div>
      `;
    }

    // Selected elements highlights
    if (!this.previewMode) {
      this.selectedItems.forEach((item, idx) => {
        if (!item.element) return;
        const rect = item.element.getBoundingClientRect();
        highlightsHtml += `
          <div class="selected-box" style="
            top: ${rect.top + scrollY}px;
            left: ${rect.left + scrollX}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
          ">
            <span class="selected-badge">${idx + 1}</span>
          </div>
        `;
      });
    }

    const count = this.selectedItems.length;
    const removedCount = this.selectedItems.filter(i => i.action === 'remove').length;
    const hiddenCount = this.selectedItems.filter(i => i.action === 'hide').length;
    const containmentWarnings = this.checkParentChildContainment();

    const normalized = normalizeUrl(window.location.href);
    const suggested = suggestPathPattern(normalized.pathname);

    this.shadow.innerHTML = `
      <style>
        :host {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          color: #0f172a;
          pointer-events: none;
        }
        * { box-sizing: border-box; }

        .candidate-box {
          position: absolute;
          border: 2px solid #6366f1;
          background: rgba(99, 102, 241, 0.08);
          pointer-events: none;
          z-index: 2147483641;
          border-radius: 4px;
        }
        .candidate-tag {
          position: absolute;
          top: -22px;
          left: 0;
          background: #4f46e5;
          color: #ffffff;
          font-size: 11px;
          padding: 2px 6px;
          border-radius: 3px;
          white-space: nowrap;
          pointer-events: none;
        }

        .selected-box {
          position: absolute;
          border: 2px solid #4f46e5;
          background: rgba(79, 70, 229, 0.12);
          pointer-events: none;
          z-index: 2147483642;
          border-radius: 4px;
        }
        .selected-badge {
          position: absolute;
          top: -12px;
          left: -12px;
          background: #4f46e5;
          color: #ffffff;
          font-size: 11px;
          font-weight: 600;
          width: 22px;
          height: 22px;
          line-height: 22px;
          text-align: center;
          border-radius: 50%;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }

        .toolbar-container {
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          background: #ffffff;
          border: 1px solid #e2e8f0;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
          border-radius: 10px;
          padding: 10px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          pointer-events: auto;
          z-index: 2147483647;
          min-width: 380px;
          max-width: 90vw;
        }

        .toolbar-info {
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .count-badge {
          background: #e0e7ff;
          color: #4338ca;
          font-size: 12px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 12px;
        }

        .action-toggle {
          display: inline-flex;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          overflow: hidden;
        }
        .action-btn {
          background: #f8fafc;
          border: none;
          padding: 4px 10px;
          font-size: 12px;
          cursor: pointer;
          color: #475569;
        }
        .action-btn.active {
          background: #4f46e5;
          color: #ffffff;
          font-weight: 500;
        }

        .toolbar-actions {
          margin-left: auto;
          display: flex;
          gap: 8px;
        }

        .btn {
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #334155;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background 150ms ease;
        }
        .btn:hover { background: #f1f5f9; }
        .btn-primary {
          background: #4f46e5;
          color: #ffffff;
          border-color: #4f46e5;
        }
        .btn-primary:hover { background: #4338ca; }
        .btn-ghost {
          border-color: transparent;
          background: transparent;
          color: #64748b;
        }
        .btn-ghost:hover { background: #f1f5f9; color: #0f172a; }

        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(15, 23, 42, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
          z-index: 2147483648;
        }
        .modal-card {
          background: #ffffff;
          border-radius: 12px;
          width: 460px;
          max-width: 90vw;
          max-height: 85vh;
          overflow-y: auto;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15);
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .modal-title {
          font-size: 15px;
          font-weight: 600;
          margin: 0;
        }
        .item-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          border-bottom: 1px solid #f1f5f9;
          font-size: 12px;
        }
        .item-info {
          display: flex;
          align-items: center;
          gap: 8px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 60%;
        }
        .scope-option {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px 10px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          cursor: pointer;
        }
        .scope-option:hover {
          border-color: #cbd5e1;
          background: #f8fafc;
        }
        .scope-label { font-weight: 500; font-size: 12px; }
        .scope-desc { font-size: 11px; color: #64748b; font-family: monospace; }
        .wildcard-tag { color: #4f46e5; font-weight: 700; }
        .warning-box {
          background: #fffbeb;
          border: 1px solid #fef3c7;
          color: #92400e;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12px;
        }
      </style>

      ${highlightsHtml}

      <div class="toolbar-container">
        <div class="toolbar-info">
          <span>已选择 <span class="count-badge">${count}</span> 个</span>
          ${!this.previewMode ? `
            <div class="action-toggle">
              <button class="action-btn ${this.defaultAction === 'remove' ? 'active' : ''}" id="btn-toggle-remove">移除</button>
              <button class="action-btn ${this.defaultAction === 'hide' ? 'active' : ''}" id="btn-toggle-hide">隐藏</button>
            </div>
          ` : `
            <span style="font-size: 12px; color: #4f46e5; font-weight: 500;">
              预览中 (${removedCount} 移除 · ${hiddenCount} 隐藏)
            </span>
          `}
        </div>

        <div class="toolbar-actions">
          ${!this.previewMode ? `
            ${count > 0 ? `<button class="btn" id="btn-show-list">查看列表</button>` : ''}
            <button class="btn btn-ghost" id="btn-cancel">取消 (Esc)</button>
            ${count > 0 ? `
              <button class="btn" id="btn-preview">预览</button>
              <button class="btn btn-primary" id="btn-confirm-scope">保存...</button>
            ` : ''}
          ` : `
            <button class="btn" id="btn-exit-preview">退出预览</button>
            <button class="btn btn-primary" id="btn-confirm-scope">确认范围并保存</button>
          `}
        </div>
      </div>

      <div id="modal-slot"></div>
    `;

    this.bindToolbarEvents();
  }

  bindToolbarEvents() {
    const shadow = this.shadow;
    if (!shadow) return;

    const btnRemove = shadow.getElementById('btn-toggle-remove');
    if (btnRemove) {
      btnRemove.onclick = () => {
        this.defaultAction = 'remove';
        for (const item of this.selectedItems) item.action = 'remove';
        this.render();
      };
    }

    const btnHide = shadow.getElementById('btn-toggle-hide');
    if (btnHide) {
      btnHide.onclick = () => {
        this.defaultAction = 'hide';
        for (const item of this.selectedItems) item.action = 'hide';
        this.render();
      };
    }

    const btnCancel = shadow.getElementById('btn-cancel');
    if (btnCancel) {
      btnCancel.onclick = () => this.stop();
    }

    const btnPreview = shadow.getElementById('btn-preview');
    if (btnPreview) {
      btnPreview.onclick = () => this.enterPreview();
    }

    const btnExitPreview = shadow.getElementById('btn-exit-preview');
    if (btnExitPreview) {
      btnExitPreview.onclick = () => this.exitPreview();
    }

    const btnShowList = shadow.getElementById('btn-show-list');
    if (btnShowList) {
      btnShowList.onclick = () => this.showListModal();
    }

    const btnConfirmScope = shadow.getElementById('btn-confirm-scope');
    if (btnConfirmScope) {
      btnConfirmScope.onclick = () => this.showScopeModal();
    }
  }

  showListModal() {
    const modalSlot = this.shadow.getElementById('modal-slot');
    if (!modalSlot) return;

    const warnings = this.checkParentChildContainment();

    modalSlot.innerHTML = `
      <div class="modal-overlay" id="list-modal-backdrop">
        <div class="modal-card">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h3 class="modal-title">待处理目标列表 (${this.selectedItems.length})</h3>
            <button class="btn btn-ghost" id="btn-close-list">关闭</button>
          </div>

          ${warnings.length > 0 ? `
            <div class="warning-box">
              ${warnings.map(w => `<div>⚠️ ${w}</div>`).join('')}
            </div>
          ` : ''}

          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${this.selectedItems.map((item, idx) => `
              <div class="item-row">
                <div class="item-info">
                  <span class="selected-badge" style="position: static; display: inline-block;">${idx + 1}</span>
                  <span title="${item.name}">${item.name}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <select class="btn item-action-select" data-id="${item.id}" style="padding: 2px 6px;">
                    <option value="remove" ${item.action === 'remove' ? 'selected' : ''}>移除</option>
                    <option value="hide" ${item.action === 'hide' ? 'selected' : ''}>隐藏</option>
                  </select>
                  <button class="btn btn-ghost item-delete-btn" data-id="${item.id}" style="color: #dc2626; padding: 2px 6px;">
                    取消
                  </button>
                </div>
              </div>
            `).join('')}
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
            <button class="btn btn-primary" id="btn-list-done">完成调整</button>
          </div>
        </div>
      </div>
    `;

    const close = () => { modalSlot.innerHTML = ''; };
    modalSlot.querySelector('#btn-close-list').onclick = close;
    modalSlot.querySelector('#btn-list-done').onclick = close;
    modalSlot.querySelector('#list-modal-backdrop').onclick = (e) => {
      if (e.target.id === 'list-modal-backdrop') close();
    };

    modalSlot.querySelectorAll('.item-action-select').forEach(sel => {
      sel.onchange = (e) => {
        const item = this.selectedItems.find(i => i.id === e.target.dataset.id);
        if (item) item.action = e.target.value;
      };
    });

    modalSlot.querySelectorAll('.item-delete-btn').forEach(btn => {
      btn.onclick = (e) => {
        const id = e.target.dataset.id;
        this.selectedItems = this.selectedItems.filter(i => i.id !== id);
        if (this.selectedItems.length === 0) {
          close();
          this.render();
        } else {
          this.showListModal();
          this.render();
        }
      };
    });
  }

  showScopeModal() {
    const modalSlot = this.shadow.getElementById('modal-slot');
    if (!modalSlot) return;

    const normalized = normalizeUrl(window.location.href);
    const suggested = suggestPathPattern(normalized.pathname);
    const removedCount = this.selectedItems.filter(i => i.action === 'remove').length;
    const hiddenCount = this.selectedItems.filter(i => i.action === 'hide').length;

    modalSlot.innerHTML = `
      <div class="modal-overlay" id="scope-modal-backdrop">
        <div class="modal-card">
          <h3 class="modal-title">确认清理规则与作用范围</h3>
          <div style="font-size: 13px; color: #475569;">
            共选择了 <strong>${this.selectedItems.length}</strong> 个目标 (${removedCount} 个移除 · ${hiddenCount} 个隐藏)。
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <label class="scope-option">
              <input type="radio" name="scope_choice" value="exact" checked>
              <div>
                <div class="scope-label">仅当前页面路径</div>
                <div class="scope-desc">${normalized.hostname}${normalized.pathname}</div>
              </div>
            </label>

            ${suggested !== normalized.pathname ? `
              <label class="scope-option">
                <input type="radio" name="scope_choice" value="suggested">
                <div>
                  <div class="scope-label">系统建议同类路径 (泛化动态片段)</div>
                  <div class="scope-desc">${normalized.hostname}${suggested.replace(/\*/g, '<span class="wildcard-tag">*</span>')}</div>
                </div>
              </label>
            ` : ''}

            <label class="scope-option">
              <input type="radio" name="scope_choice" value="hostname">
              <div>
                <div class="scope-label">当前网站全部路径</div>
                <div class="scope-desc">${normalized.hostname}/*</div>
              </div>
            </label>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;">
            <button class="btn" id="btn-cancel-scope">返回修改</button>
            <button class="btn btn-primary" id="btn-save-confirmed">确认并保存</button>
          </div>
        </div>
      </div>
    `;

    const close = () => { modalSlot.innerHTML = ''; };
    modalSlot.querySelector('#btn-cancel-scope').onclick = close;
    modalSlot.querySelector('#scope-modal-backdrop').onclick = (e) => {
      if (e.target.id === 'scope-modal-backdrop') close();
    };

    modalSlot.querySelector('#btn-save-confirmed').onclick = async () => {
      const choice = modalSlot.querySelector('input[name="scope_choice"]:checked').value;
      let pathPattern = normalized.pathname;
      if (choice === 'suggested') pathPattern = suggested;
      else if (choice === 'hostname') pathPattern = '/*';

      const res = await this.saveRules(pathPattern, choice);
      if (res) {
        close();
      }
    };
  }
}
