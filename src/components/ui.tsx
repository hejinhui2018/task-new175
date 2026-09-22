import type { ReactNode } from 'react';

export function Badge({ tone = 'gray', children }: { tone?: 'gray' | 'blue' | 'green' | 'red' | 'amber'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  added: { label: '新增', cls: 'kind-added' },
  removed: { label: '移除', cls: 'kind-removed' },
  split: { label: '题目拆分', cls: 'kind-split' },
  'options-changed': { label: '选项变化', cls: 'kind-options-changed' },
  'condition-changed': { label: '条件调整', cls: 'kind-condition-changed' },
  'scope-changed': { label: '范围调整', cls: 'kind-scope-changed' },
  modified: { label: '文案修改', cls: 'kind-modified' },
  unchanged: { label: '未变', cls: 'muted' },
};

export function KindTag({ kind }: { kind: string }) {
  const k = KIND_LABEL[kind] ?? { label: kind, cls: '' };
  return <span className={k.cls}>{k.label}</span>;
}

export const CONFLICT_LABEL: Record<string, { label: string; hard: boolean }> = {
  'option-removed': { label: '已选选项已删除（自动剔除，仅警告）', hard: false },
  'ambiguous-split': { label: '拆分去向不唯一，需要人工确认', hard: true },
  'condition-hidden': { label: '迁移后目标题被条件隐藏', hard: true },
  'scope-excluded': { label: '目标题不在本草稿平台/地区范围', hard: true },
  'already-answered': { label: '目标题已有人工答案，避免覆盖', hard: true },
};

export const CHECK_LABEL: Record<string, string> = {
  completeness: '完整性',
  'content-review': '内容复核',
  'asset-check': '素材检查',
};

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function platformLabel(p: string): string {
  return p === 'android' ? 'Android' : 'iOS';
}
