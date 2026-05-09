import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { MatterDetail, MatterStatus } from '../../bridge/types';
import { getMatter, transitionMatter } from '../../api/todoApi';
import { Toast } from '../../utils/toast';
import UserName from '../../ui/UserName';
import './index.css';

export interface MatterDetailPanelProps {
  channelId: string;
  channelType: number;
  matterId?: string;
  onClose: () => void;
}

type TabKey = 'channels' | 'outputs' | 'changelog';

export default function MatterDetailPanel({ channelId, channelType, matterId, onClose }: MatterDetailPanelProps) {
  const [matter, setMatter] = useState<MatterDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('channels');
  const [briefOpen, setBriefOpen] = useState(true);

  useEffect(() => {
    if (!matterId) { setMatter(null); return; }
    setLoading(true);
    setError(null);
    getMatter(matterId, channelId || undefined)
      .then(setMatter)
      .catch((err) => { setError(err?.message || '加载失败'); setMatter(null); })
      .finally(() => setLoading(false));
  }, [matterId, channelId]);

  const handleStatusChange = useCallback(async (newStatus: MatterStatus) => {
    if (!matter) return;
    const oldStatus = matter.status;
    setMatter((prev) => prev ? { ...prev, status: newStatus } : prev);
    try {
      const updated = await transitionMatter(matter.id, newStatus);
      setMatter(updated);
    } catch {
      setMatter((prev) => prev ? { ...prev, status: oldStatus } : prev);
      Toast.error('状态修改失败');
    }
  }, [matter]);

  // 空态 / 加载态 / 错误态
  if (!matterId || loading || error || !matter) {
    return (
      <div className="wk-mp">
        <div className="wk-mp-head">
          <div className="wk-mp-head__row1">
            <span className="wk-mp-head__id">{loading ? '加载中...' : '事项'}</span>
            <div className="wk-mp-head__actions">
              <button type="button" className="wk-mp-head__close" onClick={onClose}>✕</button>
            </div>
          </div>
        </div>
        <div className="wk-mp__scroll">
          <div className="wk-mp-empty">{error || (!matterId ? '选择一个事项查看详情' : '事项不存在')}</div>
        </div>
      </div>
    );
  }

  const channels = matter.channels || [];
  const assignees = matter.assignees || [];
  const statusCss = matter.status === 'open' ? 'active' : matter.status;

  const tabs: { id: TabKey; label: string; count: number }[] = [
    { id: 'channels', label: '关联群聊', count: channels.length },
    { id: 'outputs', label: '产出文件', count: 0 },
    { id: 'changelog', label: '变更记录', count: 0 },
  ];

  return (
    <div className="wk-mp">
      {/* ── Head (对齐原型 m-head) ── */}
      <div className="wk-mp-head">
        <div className="wk-mp-head__row1">
          <span className="wk-mp-head__id">{matter.id.slice(0, 8)}</span>
          <StatusPicker status={matter.status} onChange={handleStatusChange} />
          {matter.deadline && (
            <span className="wk-mp-head__ddl">DDL {new Date(matter.deadline).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span>
          )}
          <div className="wk-mp-head__actions">
            <button type="button" className="wk-mp-head__btn">转发</button>
            <button type="button" className="wk-mp-head__close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="wk-mp-head__title">{matter.title}</div>
        <div className="wk-mp-head__meta-row">
          {/* 发起 */}
          <span className="wk-mp-head__meta">
            <span className="wk-mp-head__meta-label">发起</span>
            <UserName uid={matter.creator_id} className="wk-mp-head__meta-name" />
          </span>
          {/* 负责 */}
          {assignees.length > 0 && (
            <span className="wk-mp-head__meta">
              <span className="wk-mp-head__meta-label">负责</span>
              {assignees.map((a, i) => (
                <span key={a.user_id}>
                  {i > 0 && '、'}
                  <UserName uid={a.user_id} className="wk-mp-head__meta-name" />
                </span>
              ))}
            </span>
          )}
          {/* 关联 */}
          {channels.length > 0 && (
            <span className="wk-mp-head__meta">
              <span className="wk-mp-head__meta-label">关联</span>
              <span className="wk-mp-head__channels">
                {channels.slice(0, 2).map((ch) => (
                  <span key={ch.id} className="wk-mp-head__channel-tag">#{ch.channel_name || ch.channel_id.slice(0, 6)}</span>
                ))}
                {channels.length > 2 && <span className="wk-mp-head__channel-more">+{channels.length - 2} 更多</span>}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* ── BRIEF (对齐原型 m-brief) ── */}
      {matter.description && (
        <div className="wk-mp-brief">
          <div className="wk-mp-brief__head" onClick={() => setBriefOpen(!briefOpen)}>
            <span className="wk-mp-brief__title">主要目标</span>
            <span className="wk-mp-brief__toggle">{briefOpen ? '收起' : '展开'}</span>
          </div>
          {briefOpen && (
            <div className="wk-mp-brief__text">{matter.description}</div>
          )}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="wk-mp-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`wk-mp-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count > 0 && <span className="wk-mp-tab__count">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <div className="wk-mp__scroll">
        {tab === 'channels' && (
          <div className="wk-mp-tab-content">
            {channels.length === 0 ? (
              <div className="wk-mp-empty">暂无关联群聊</div>
            ) : (
              channels.map((ch) => (
                <div key={ch.id} className="wk-mp-channel-item">
                  <span className="wk-mp-channel-item__name">#{ch.channel_name || ch.channel_id}</span>
                  <span className="wk-mp-channel-item__type">
                    {ch.channel_type === 2 ? '群组' : ch.channel_type === 1 ? '私聊' : '子区'}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        {tab === 'outputs' && (
          <div className="wk-mp-tab-content">
            <div className="wk-mp-empty">产出文件功能即将上线</div>
          </div>
        )}
        {tab === 'changelog' && (
          <div className="wk-mp-tab-content">
            <div className="wk-mp-empty">变更记录功能即将上线</div>
          </div>
        )}
      </div>
    </div>
  );
}

export { MatterDetailPanel };

// ─── StatusPicker ─────────────────────────────────────────

const STATUS_OPTIONS: { value: MatterStatus; label: string; cssKey: string }[] = [
  { value: 'open', label: '进行中', cssKey: 'active' },
  { value: 'done', label: '已完成', cssKey: 'done' },
  { value: 'archived', label: '已归档', cssKey: 'archived' },
];

function StatusPicker({ status, onChange }: { status: MatterStatus; onChange: (s: MatterStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const current = STATUS_OPTIONS.find((o) => o.value === status) || STATUS_OPTIONS[0];

  return (
    <div className="wk-mp-status-picker" ref={ref}>
      <button
        type="button"
        className={`wk-mp-head__status wk-mp-head__status--${current.cssKey}`}
        onClick={() => setOpen(!open)}
      >
        <span className="wk-mp-head__status-dot" />
        {current.label}
      </button>
      {open && (
        <div className="wk-mp-status-picker__dropdown">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`wk-mp-status-picker__option${opt.value === status ? ' is-active' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              <span className="wk-mp-head__status-dot" />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
