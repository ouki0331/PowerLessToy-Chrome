/**
 * Debug Overlay (STATUS-DEBUG-001, DEC-010, DEC-011).
 * Displays low-interference hollow diamond markers at processed element positions.
 * Supports direct in-situ recovery and controlled reload fallback.
 */

import { setRuleEnabled } from '../common/storage.js';

export class DebugOverlay {
  constructor(domEngine, documentRef = document) {
    this.engine = domEngine;
    this.doc = documentRef;
    this.host = null;
    this.shadow = null;
    this.active = false;
    this.activeFlyout = null;

    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  /**
   * Activates or deactivates debug mode for the current tab session.
   *
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    if (this.active === enabled) return;
    this.active = enabled;

    if (this.active) {
      this.setupShadowDom();
      this.render();
      this.doc.addEventListener('keydown', this.handleKeyDown, true);
    } else {
      this.teardown();
    }
  }

  teardown() {
    this.active = false;
    this.doc.removeEventListener('keydown', this.handleKeyDown, true);
    if (this.host && this.host.parentNode) {
      this.host.remove();
    }
    this.host = null;
    this.shadow = null;
    this.activeFlyout = null;
  }

  setupShadowDom() {
    if (this.host) return;
    this.host = this.doc.createElement('div');
    this.host.id = 'element-remover-debug-root';
    this.host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; z-index: 2147483645; pointer-events: none;';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.doc.documentElement.appendChild(this.host);
  }

  handleKeyDown(e) {
    if (!this.active) return;
    if (e.key === 'Escape' && this.activeFlyout) {
      e.preventDefault();
      this.closeFlyout();
    }
  }

  closeFlyout() {
    this.activeFlyout = null;
    this.render();
  }

  /**
   * Collects marker positions from engine instances.
   */
  getMarkerPoints() {
    const points = [];
    const scrollX = window.scrollX || 0;
    const scrollY = window.scrollY || 0;

    for (const [ruleId, instances] of this.engine.instances.entries()) {
      const rule = this.engine.rules.find(r => r.id === ruleId) || { id: ruleId, name: ruleId, action: 'remove' };

      for (const inst of instances) {
        if (!inst.active) continue;

        let rect = null;
        if (inst.action === 'remove' && inst.anchor && inst.anchor.parentNode) {
          // Approximate position from anchor's parent or next sibling
          const parent = inst.anchor.parentNode;
          if (parent.getBoundingClientRect) {
            rect = parent.getBoundingClientRect();
          }
        } else if (inst.action === 'hide' && inst.element && inst.element.getBoundingClientRect) {
          rect = inst.element.getBoundingClientRect();
        }

        if (rect) {
          points.push({
            ruleId,
            rule,
            inst,
            x: rect.left + scrollX,
            y: rect.top + scrollY
          });
        }
      }
    }

    // Cluster overlapping points within 24px
    const clusters = [];
    for (const pt of points) {
      let clustered = false;
      for (const cl of clusters) {
        const dx = Math.abs(cl.x - pt.x);
        const dy = Math.abs(cl.y - pt.y);
        if (dx <= 24 && dy <= 24) {
          cl.points.push(pt);
          clustered = true;
          break;
        }
      }
      if (!clustered) {
        clusters.push({
          x: pt.x,
          y: pt.y,
          points: [pt]
        });
      }
    }

    return clusters;
  }

  async executeRestore(ruleId, instanceOnly = false) {
    if (instanceOnly) {
      // Just temporarily show in current session
      const instances = this.engine.instances.get(ruleId) || [];
      for (const inst of instances) {
        if (inst.element) {
          inst.element.removeAttribute('data-element-remover-hidden');
          inst.element.style.removeProperty('display');
          inst.element.style.removeProperty('visibility');
          if (inst.anchor && inst.anchor.parentNode) {
            inst.anchor.parentNode.insertBefore(inst.element, inst.anchor);
          }
          inst.active = false;
        }
      }
      this.closeFlyout();
      this.render();
      this.showToast('已在当前页面临时显示此元素');
      return;
    }

    // Permanent disable in storage + in-situ restore
    const restoreResult = this.engine.restoreRule(ruleId);

    if (restoreResult.success) {
      await setRuleEnabled(ruleId, false);
      this.closeFlyout();
      this.render();
      this.showToast('已恢复元素并停用规则', ruleId);
    } else if (restoreResult.requiresReload) {
      // Show reload confirmation dialog (STATUS-DEBUG-001, 场景 D)
      this.showReloadModal(ruleId);
    }
  }

  showToast(message, ruleId = null) {
    if (!this.shadow) return;
    const toastSlot = this.shadow.getElementById('toast-slot');
    if (!toastSlot) return;

    toastSlot.innerHTML = `
      <div class="debug-toast">
        <span>${message}</span>
        ${ruleId ? `<button class="btn-undo" id="btn-undo-restore">撤销恢复</button>` : ''}
      </div>
    `;

    if (ruleId) {
      const undoBtn = toastSlot.querySelector('#btn-undo-restore');
      if (undoBtn) {
        undoBtn.onclick = async () => {
          await setRuleEnabled(ruleId, true);
          const rule = this.engine.rules.find(r => r.id === ruleId);
          if (rule) {
            rule.enabled = true;
            this.engine.applyRule(rule);
            this.engine.notifyCountChange();
          }
          toastSlot.innerHTML = '';
          this.render();
        };
      }
    }

    setTimeout(() => {
      if (toastSlot) toastSlot.innerHTML = '';
    }, 4500);
  }

  showReloadModal(ruleId) {
    if (!this.shadow) return;
    const modalSlot = this.shadow.getElementById('modal-slot');
    if (!modalSlot) return;

    modalSlot.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-card">
          <h3 style="margin: 0; font-size: 15px; font-weight: 600;">需要刷新网页才能恢复</h3>
          <p style="font-size: 13px; color: #475569; line-height: 1.5; margin: 0;">
            对应规则已停用。页面目标容器已重建，无法安全原位放回。刷新后目标将重新展示，我们将尽量恢复原浏览位置。<br><br>
            <strong>注意：</strong>未提交的表单内容可能会丢失。
          </p>
          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
            <button class="btn" id="btn-cancel-reload">暂不刷新</button>
            <button class="btn btn-primary" id="btn-confirm-reload">刷新并恢复</button>
          </div>
        </div>
      </div>
    `;

    modalSlot.querySelector('#btn-cancel-reload').onclick = () => {
      modalSlot.innerHTML = '';
      this.closeFlyout();
    };

    modalSlot.querySelector('#btn-confirm-reload').onclick = async () => {
      await setRuleEnabled(ruleId, false);
      this.engine.prepareControlledReload(ruleId);
      window.location.reload();
    };
  }

  render() {
    if (!this.active || !this.shadow) return;

    const clusters = this.getMarkerPoints();

    let markersHtml = '';
    clusters.forEach((cluster, idx) => {
      const count = cluster.points.length;
      const isSelected = this.activeFlyout && this.activeFlyout.clusterIndex === idx;

      markersHtml += `
        <div class="debug-marker ${isSelected ? 'active' : ''}"
             data-cluster-idx="${idx}"
             tabindex="0"
             role="button"
             aria-label="Debug 标记: ${count} 个被处理目标"
             style="top: ${cluster.y}px; left: ${cluster.x}px;">
          <div class="diamond-shape"></div>
          ${count > 1 ? `<span class="cluster-badge">${count}</span>` : ''}
        </div>
      `;
    });

    let flyoutHtml = '';
    if (this.activeFlyout) {
      const cluster = clusters[this.activeFlyout.clusterIndex];
      if (cluster) {
        const point = cluster.points[0];
        const rule = point.rule;
        const totalCount = cluster.points.length;

        flyoutHtml = `
          <div class="debug-flyout" style="top: ${cluster.y + 20}px; left: ${cluster.x}px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div style="font-weight: 600; font-size: 13px;">${rule.name || rule.selector}</div>
              <button class="btn-close" id="btn-close-flyout">✕</button>
            </div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
              ${rule.action === 'hide' ? '已隐藏' : '已移除'} · 规则 #${rule.id.slice(-6)} · ${rule.status === 'needs_review' ? '需要复核' : '精确'}
            </div>

            <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 6px;">
              <button class="btn btn-primary" id="btn-restore-rule">
                恢复并停用规则 ${totalCount > 1 ? `(将恢复 ${totalCount} 个元素)` : ''}
              </button>
              <button class="btn btn-ghost" id="btn-restore-once">
                仅本次显示此元素
              </button>
            </div>
          </div>
        `;
      }
    }

    this.shadow.innerHTML = `
      <style>
        :host {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          color: #0f172a;
          pointer-events: none;
        }
        * { box-sizing: border-box; }

        .debug-marker {
          position: absolute;
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          pointer-events: auto;
          outline: none;
          z-index: 2147483645;
          transform: translate(-50%, -50%);
        }
        .debug-marker:focus-visible .diamond-shape {
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.4);
        }

        .diamond-shape {
          width: 14px;
          height: 14px;
          border: 2px solid #5b5bd6;
          background: rgba(91, 91, 214, 0.15);
          transform: rotate(45deg);
          border-radius: 2px;
          transition: transform 150ms ease, background 150ms ease;
        }
        .debug-marker:hover .diamond-shape, .debug-marker.active .diamond-shape {
          background: #5b5bd6;
          border-color: #4f46e5;
          transform: rotate(45deg) scale(1.15);
        }

        .cluster-badge {
          position: absolute;
          top: -6px;
          right: -6px;
          background: #4f46e5;
          color: #ffffff;
          font-size: 10px;
          font-weight: 700;
          padding: 1px 4px;
          border-radius: 8px;
        }

        .debug-flyout {
          position: absolute;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
          padding: 12px;
          width: 260px;
          pointer-events: auto;
          z-index: 2147483646;
          animation: fadeIn 150ms ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
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
          font-size: 11px;
        }
        .btn-ghost:hover { background: #f8fafc; color: #0f172a; }
        .btn-close {
          border: none;
          background: transparent;
          color: #94a3b8;
          font-size: 12px;
          cursor: pointer;
          padding: 2px 4px;
        }
        .btn-close:hover { color: #0f172a; }

        .debug-toast {
          position: fixed;
          bottom: 24px;
          right: 24px;
          background: #0f172a;
          color: #ffffff;
          padding: 10px 16px;
          border-radius: 8px;
          font-size: 13px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2);
          display: flex;
          align-items: center;
          gap: 12px;
          pointer-events: auto;
          z-index: 2147483649;
        }
        .btn-undo {
          border: none;
          background: #334155;
          color: #f8fafc;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
        }
        .btn-undo:hover { background: #475569; }

        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(15, 23, 42, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
          z-index: 2147483649;
        }
        .modal-card {
          background: #ffffff;
          border-radius: 12px;
          width: 400px;
          max-width: 90vw;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15);
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
      </style>

      ${markersHtml}
      ${flyoutHtml}

      <div id="toast-slot"></div>
      <div id="modal-slot"></div>
    `;

    this.bindEvents(clusters);
  }

  bindEvents(clusters) {
    const shadow = this.shadow;
    if (!shadow) return;

    shadow.querySelectorAll('.debug-marker').forEach(marker => {
      const idx = parseInt(marker.dataset.clusterIdx, 10);

      marker.onclick = (e) => {
        e.stopPropagation();
        this.activeFlyout = { clusterIndex: idx };
        this.render();
      };

      marker.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.activeFlyout = { clusterIndex: idx };
          this.render();
        }
      };
    });

    const btnClose = shadow.getElementById('btn-close-flyout');
    if (btnClose) {
      btnClose.onclick = () => this.closeFlyout();
    }

    const btnRestore = shadow.getElementById('btn-restore-rule');
    if (btnRestore && this.activeFlyout) {
      const cluster = clusters[this.activeFlyout.clusterIndex];
      if (cluster && cluster.points.length > 0) {
        const ruleId = cluster.points[0].ruleId;
        btnRestore.onclick = () => this.executeRestore(ruleId, false);
      }
    }

    const btnRestoreOnce = shadow.getElementById('btn-restore-once');
    if (btnRestoreOnce && this.activeFlyout) {
      const cluster = clusters[this.activeFlyout.clusterIndex];
      if (cluster && cluster.points.length > 0) {
        const ruleId = cluster.points[0].ruleId;
        btnRestoreOnce.onclick = () => this.executeRestore(ruleId, true);
      }
    }
  }
}
