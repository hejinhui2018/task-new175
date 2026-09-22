import { useSyncExternalStore } from 'react';
import { applyDraftMigration } from '../domain/migration';
import {
  freezeBatch,
  recomputeStale,
  recordReviewResult,
  releaseBatch,
  type RecordReviewInput,
} from '../domain/batches';
import { buildSampleState } from '../domain/seed';
import type {
  Answer,
  AnswerSource,
  AppState,
  AssetRef,
  Draft,
  DraftMigrationPreview,
  FormVersion,
  MigrationPlan,
  Question,
} from '../domain/types';
import { loadState, saveState } from './persistence';

const HISTORY_LIMIT = 50;

class AppStore {
  private state: AppState;
  private past: AppState[] = [];
  private future: AppState[] = [];
  private lastAction = '';
  private listeners = new Set<() => void>();
  private storage: Storage | undefined;

  constructor(initial: AppState, storage?: Storage) {
    this.state = initial;
    this.storage = storage;
  }

  getState = (): AppState => this.state;
  canUndo = (): boolean => this.past.length > 0;
  canRedo = (): boolean => this.future.length > 0;
  getLastAction = (): string => this.lastAction;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    if (this.storage) saveState(this.state, Date.now(), this.storage);
    this.listeners.forEach((fn) => fn());
  }

  private commit(next: AppState, label: string): void {
    this.past.push(this.state);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.state = next;
    this.lastAction = label;
    this.emit();
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.state);
    this.state = prev;
    this.lastAction = '撤销';
    this.emit();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state);
    this.state = next;
    this.lastAction = '重做';
    this.emit();
  }

  private versionsById(): Map<string, FormVersion> {
    return new Map(this.state.versions.map((v) => [v.id, v]));
  }
  private draftsById(): Map<string, Draft> {
    return new Map(this.state.drafts.map((d) => [d.id, d]));
  }

  // ── 表单版本 ──────────────────────────────────────────────
  setActiveVersion(id: string): void {
    if (!this.state.versions.some((v) => v.id === id)) return;
    this.commit({ ...this.state, activeVersionId: id }, '切换表单版本');
  }

  addVersion(version: FormVersion): void {
    this.commit(
      { ...this.state, versions: [...this.state.versions, version], activeVersionId: version.id },
      `新建版本 ${version.name}`,
    );
  }

  updateQuestion(versionId: string, question: Question): void {
    const versions = this.state.versions.map((v) =>
      v.id !== versionId
        ? v
        : { ...v, questions: v.questions.map((q) => (q.key === question.key ? question : q)) },
    );
    this.commit({ ...this.state, versions }, `编辑题目 ${question.title}`);
  }

  addPlan(plan: MigrationPlan): void {
    this.commit({ ...this.state, plans: [...this.state.plans, plan] }, '保存迁移计划');
  }

  // ── 草稿 / 答案 / 素材 ────────────────────────────────────
  setAnswer(draftId: string, questionKey: string, patch: Partial<Omit<Answer, 'questionKey'>>): void {
    const drafts = this.state.drafts.map((d) => {
      if (d.id !== draftId) return d;
      const exists = d.answers.some((a) => a.questionKey === questionKey);
      const fallbackSource: AnswerSource = patch.source ?? { kind: 'manual' };
      const answers = exists
        ? d.answers.map((a) => (a.questionKey === questionKey ? { ...a, ...patch } : a))
        : [
            ...d.answers,
            {
              questionKey,
              optionIds: patch.optionIds ?? [],
              text: patch.text ?? '',
              source: fallbackSource,
              basedOn: patch.basedOn ?? `${d.formVersionId}:${questionKey}`,
            } as Answer,
          ];
      return { ...d, answers, status: 'draft' as const, updatedAt: Date.now() };
    });
    this.commit({ ...this.state, drafts }, '编辑答案');
  }

  replaceAsset(draftId: string, assetId: string, patch: Partial<Pick<AssetRef, 'fingerprint' | 'name'>>): void {
    const drafts = this.state.drafts.map((d) =>
      d.id !== draftId
        ? d
        : {
            ...d,
            assets: d.assets.map((a) => (a.id === assetId ? { ...a, ...patch } : a)),
            updatedAt: Date.now(),
          },
    );
    this.commit({ ...this.state, drafts }, '替换素材');
  }

  setDraftStatus(draftId: string, status: Draft['status']): void {
    const drafts = this.state.drafts.map((d) =>
      d.id === draftId ? { ...d, status, updatedAt: Date.now() } : d,
    );
    this.commit({ ...this.state, drafts }, `草稿状态 → ${status}`);
  }

  /** 批量应用迁移（逐份确认后调用；只包含用户选中的草稿） */
  applyMigrations(items: { draftId: string; preview: DraftMigrationPreview }[]): void {
    const to = this.state.versions.find((v) => v.id === this.state.activeVersionId);
    if (!to) return;
    const now = Date.now();
    const previews = new Map(items.map((i) => [i.draftId, i.preview]));
    const drafts = this.state.drafts.map((d) => {
      const pv = previews.get(d.id);
      return pv ? applyDraftMigration(d, to, pv, now) : d;
    });
    this.commit({ ...this.state, drafts }, `迁移 ${items.length} 份草稿`);
  }

  /** 版本回退：恢复迁移前快照 */
  rollbackDraft(draftId: string): void {
    const drafts = this.state.drafts.map((d) => {
      if (d.id !== draftId || !d.previousSnapshot) return d;
      const snap = d.previousSnapshot;
      return {
        ...d,
        formVersionId: snap.formVersionId,
        answers: snap.answers,
        previousSnapshot: undefined,
        status: 'draft' as const,
        updatedAt: Date.now(),
      };
    });
    this.commit({ ...this.state, drafts }, '版本回退');
  }

  // ── 批次 / 审核 ───────────────────────────────────────────
  freezeBatch(label: string, draftIds: string[]): void {
    const drafts = this.state.drafts.filter((d) => draftIds.includes(d.id));
    const batch = freezeBatch(label, drafts, this.versionsById(), Date.now());
    this.commit({ ...this.state, batches: [batch, ...this.state.batches] }, `冻结批次 ${label}`);
  }

  recordReview(input: Omit<RecordReviewInput, 'receivedAt'>): void {
    const refreshed = this.state.batches.map((b) =>
      recomputeStale(b, this.draftsById(), this.versionsById()),
    );
    const outcome = recordReviewResult(
      refreshed,
      this.draftsById(),
      this.versionsById(),
      { ...input, receivedAt: Date.now() },
    );
    this.commit(
      { ...this.state, batches: outcome.batches, reviewLog: [outcome.event, ...this.state.reviewLog] },
      outcome.event.accepted ? `登记审核结果 ${input.type}` : `拒收审核结果（${outcome.event.reason}）`,
    );
  }

  releaseBatch(batchId: string): void {
    const refreshed = this.state.batches.map((b) =>
      recomputeStale(b, this.draftsById(), this.versionsById()),
    );
    this.commit(
      { ...this.state, batches: releaseBatch(refreshed, batchId, Date.now()) },
      '放行发布批次',
    );
  }

  /** 视图用：附带动态过期标记与放行状态的批次 */
  batchesWithFreshness() {
    return this.state.batches.map((b) =>
      recomputeStale(b, this.draftsById(), this.versionsById()),
    );
  }

  resetSample(): void {
    const fresh = buildSampleState(Date.now());
    this.past = [];
    this.future = [];
    this.state = fresh;
    this.lastAction = '重置样例';
    this.emit();
  }

  /** 直接替换为给定状态并清空历史栈（测试/恢复场景） */
  hydrate(state: AppState): void {
    this.past = [];
    this.future = [];
    this.state = state;
    this.lastAction = '已恢复';
    this.emit();
  }
}

export function createStore(storage: Storage | undefined): AppStore {
  const persisted = storage ? loadState(storage) : undefined;
  const initial = persisted?.state ?? buildSampleState(Date.now());
  return new AppStore(initial, storage);
}

export const storeSingleton = createStore(
  typeof localStorage === 'undefined' ? undefined : localStorage,
);

/** 测试支持：丢弃历史栈，重新从（已清空的）持久化存储或样例装载 */
export function resetStoreSingleton(storage?: Storage): AppStore {
  storeSingleton.hydrate(createStore(storage).getState());
  return storeSingleton;
}

export function useAppState(): AppState {
  return useSyncExternalStore(storeSingleton.subscribe, storeSingleton.getState, storeSingleton.getState);
}

export function useStore(): AppStore {
  useSyncExternalStore(storeSingleton.subscribe, storeSingleton.getState, storeSingleton.getState);
  return storeSingleton;
}
