import { useSyncExternalStore } from 'react'
import { freezeBatch, ingestReviewResult, rerunCheck } from '../domain/batch'
import { applyMigrationToDraft, type MigrationPlan } from '../domain/migration'
import { createSampleState } from '../domain/sample'
import { clone, newId } from '../domain/util'
import type {
  AppState,
  AssetRef,
  AnswerValue,
  CheckKind,
  Draft,
  FormVersion,
  ReviewResult,
} from '../domain/types'

// ---------- Action ----------

export type Action =
  | { type: 'answer/set'; draftId: string; questionId: string; value: AnswerValue; at?: number }
  | { type: 'answer/clear'; draftId: string; questionId: string; at?: number }
  | { type: 'asset/add'; draftId: string; asset: AssetRef; at?: number }
  | { type: 'asset/remove'; draftId: string; assetId: string; at?: number }
  | { type: 'version/add'; version: FormVersion; makeCurrent?: boolean; at?: number }
  | { type: 'version/rollback'; versionId: string; at?: number }
  | { type: 'version/setCurrent'; versionId: string; at?: number }
  | { type: 'migration/apply'; plan: MigrationPlan; draftIds: string[]; at?: number }
  | { type: 'batch/freeze'; label: string; draftIds: string[]; at?: number }
  | { type: 'check/rerun'; batchId: string; kind: CheckKind; at?: number }
  | { type: 'review/ingest'; result: ReviewResult; at?: number }
  | { type: 'state/replace'; state: AppState; at?: number }

// ---------- Reducer ----------

function mapDraft(state: AppState, draftId: string, fn: (d: Draft) => Draft): AppState {
  return { ...state, drafts: state.drafts.map(d => (d.id === draftId ? fn(d) : d)) }
}

export function reducer(state: AppState, action: Action): AppState {
  const at = action.at ?? Date.now()
  switch (action.type) {
    case 'answer/set':
      return mapDraft(state, action.draftId, d => ({
        ...d,
        answers: {
          ...d.answers,
          [action.questionId]: { questionId: action.questionId, value: action.value, source: 'manual', updatedAt: at },
        },
        updatedAt: at,
      }))

    case 'answer/clear':
      return mapDraft(state, action.draftId, d => {
        if (!(action.questionId in d.answers)) return d
        const answers = { ...d.answers }
        delete answers[action.questionId]
        return { ...d, answers, updatedAt: at }
      })

    case 'asset/add':
      return mapDraft(state, action.draftId, d => ({ ...d, assets: [...d.assets, action.asset], updatedAt: at }))

    case 'asset/remove':
      return mapDraft(state, action.draftId, d =>
        d.assets.some(a => a.id === action.assetId)
          ? { ...d, assets: d.assets.filter(a => a.id !== action.assetId), updatedAt: at }
          : d,
      )

    case 'version/add':
      return {
        ...state,
        formVersions: [...state.formVersions, action.version],
        currentFormVersionId: action.makeCurrent === false ? state.currentFormVersionId : action.version.id,
      }

    case 'version/rollback': {
      const src = state.formVersions.find(v => v.id === action.versionId)
      if (!src) return state
      const copy: FormVersion = {
        ...clone(src),
        id: newId('fv'),
        label: `${src.label} · 回退`,
        note: `回退自「${src.label}」`,
        createdAt: at,
      }
      return { ...state, formVersions: [...state.formVersions, copy], currentFormVersionId: copy.id }
    }

    case 'version/setCurrent':
      return state.formVersions.some(v => v.id === action.versionId)
        ? { ...state, currentFormVersionId: action.versionId }
        : state

    case 'migration/apply': {
      const from = state.formVersions.find(v => v.id === action.plan.fromVersionId)
      const to = state.formVersions.find(v => v.id === action.plan.toVersionId)
      if (!from || !to) return state
      return {
        ...state,
        drafts: state.drafts.map(d =>
          action.draftIds.includes(d.id) && d.formVersionId === from.id
            ? applyMigrationToDraft(action.plan, d, from, to, at)
            : d,
        ),
      }
    }

    case 'batch/freeze': {
      const version = state.formVersions.find(v => v.id === state.currentFormVersionId)
      if (!version) return state
      const ids = action.draftIds.filter(id => state.drafts.some(d => d.id === id && d.formVersionId === version.id))
      if (ids.length === 0) return state
      const label = action.label.trim() || `批次 ${state.batches.length + 1}`
      const batch = freezeBatch(newId('b'), label, ids, state.drafts, version, at)
      return { ...state, batches: [...state.batches, batch] }
    }

    case 'check/rerun': {
      const batch = state.batches.find(b => b.id === action.batchId)
      if (!batch) return state
      const version = state.formVersions.find(v => v.id === batch.formVersionId)
      if (!version) return state
      return {
        ...state,
        batches: state.batches.map(b => (b.id === action.batchId ? rerunCheck(b, action.kind, state.drafts, version, at) : b)),
      }
    }

    case 'review/ingest': {
      const { batches, entry } = ingestReviewResult(
        state.batches,
        action.result,
        state.drafts,
        state.formVersions,
        state.reviewLog,
        at,
      )
      return { ...state, batches, reviewLog: [...state.reviewLog, entry] }
    }

    case 'state/replace':
      return action.state
  }
}

// ---------- 历史（撤销/重做） ----------

const HISTORY_LIMIT = 100

export interface History {
  past: AppState[]
  present: AppState
  future: AppState[]
}

// ---------- 存储 ----------

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export class MemoryStorage implements StorageLike {
  private data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
}

export function loadHistory(storage: StorageLike, key: string): History | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const h = JSON.parse(raw) as History
    if (
      !h ||
      !h.present ||
      !Array.isArray(h.present.formVersions) ||
      !Array.isArray(h.present.drafts) ||
      !Array.isArray(h.present.batches) ||
      !Array.isArray(h.present.reviewLog) ||
      !Array.isArray(h.past) ||
      !Array.isArray(h.future)
    ) {
      return null
    }
    return h
  } catch {
    return null
  }
}

export class Store {
  private history: History
  private listeners = new Set<() => void>()

  constructor(
    private storage: StorageLike,
    private key: string,
  ) {
    this.history = loadHistory(storage, key) ?? { past: [], present: createSampleState(), future: [] }
  }

  get present(): AppState {
    return this.history.present
  }
  get canUndo(): boolean {
    return this.history.past.length > 0
  }
  get canRedo(): boolean {
    return this.history.future.length > 0
  }
  get undoDepth(): number {
    return this.history.past.length
  }
  get redoDepth(): number {
    return this.history.future.length
  }

  dispatch(action: Action): void {
    const next = reducer(this.history.present, action)
    if (next === this.history.present) return
    this.history = {
      past: [...this.history.past.slice(-(HISTORY_LIMIT - 1)), this.history.present],
      present: next,
      future: [],
    }
    this.persist()
    this.emit()
  }

  undo(): void {
    if (!this.canUndo) return
    const prev = this.history.past[this.history.past.length - 1]
    this.history = {
      past: this.history.past.slice(0, -1),
      present: prev,
      future: [this.history.present, ...this.history.future],
    }
    this.persist()
    this.emit()
  }

  redo(): void {
    if (!this.canRedo) return
    const [next, ...rest] = this.history.future
    this.history = {
      past: [...this.history.past, this.history.present],
      present: next,
      future: rest,
    }
    this.persist()
    this.emit()
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getSnapshot = (): History => {
    return this.history
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  private persist(): void {
    try {
      this.storage.setItem(this.key, JSON.stringify(this.history))
    } catch {
      // 存储不可用时静默降级为内存态
    }
  }
}

// ---------- React 绑定 ----------

export const PERSIST_KEY = 'storedraft:v1'

function defaultStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    // 隐私模式等场景下落回内存
  }
  return new MemoryStorage()
}

export const appStore = new Store(defaultStorage(), PERSIST_KEY)

export function useAppStore(): {
  state: AppState
  canUndo: boolean
  canRedo: boolean
  undoDepth: number
  redoDepth: number
  dispatch: (action: Action) => void
  undo: () => void
  redo: () => void
} {
  const history = useSyncExternalStore(appStore.subscribe, appStore.getSnapshot, appStore.getSnapshot)
  return {
    state: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undoDepth: history.past.length,
    redoDepth: history.future.length,
    dispatch: appStore.dispatch.bind(appStore),
    undo: appStore.undo.bind(appStore),
    redo: appStore.redo.bind(appStore),
  }
}
