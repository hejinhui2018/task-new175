import { describe, expect, it } from 'vitest'
import {
  checkStates,
  currentFingerprint,
  freezeBatch,
  ingestReviewResult,
  isReleasable,
  rerunCheck,
} from './batch'
import { createSampleState } from './sample'
import type { Draft, ReviewResult } from './types'

const state = createSampleState()
const [v1] = state.formVersions
const batch = state.batches[0]

function withAnswer(drafts: Draft[], draftId: string, questionId: string, value: string): Draft[] {
  return drafts.map(d =>
    d.id === draftId
      ? {
          ...d,
          answers: {
            ...d.answers,
            [questionId]: { questionId, value, source: 'manual' as const, updatedAt: 1 },
          },
        }
      : d,
  )
}

const fixedEu = withAnswer(state.drafts, 'd_android_eu', 'q_region_note', '我们仅在欧盟境内处理必要数据。')

describe('批次冻结与检查', () => {
  it('冻结时运行三类检查并记录结果', () => {
    expect(batch.checks.map(c => c.kind).sort()).toEqual(['asset-check', 'completeness', 'content-review'])
    const completeness = batch.checks.find(c => c.kind === 'completeness')!
    expect(completeness.status).toBe('failed')
    expect(completeness.detail).toContain('欧盟') // Android/欧盟 缺地区声明
    expect(batch.checks.find(c => c.kind === 'content-review')!.status).toBe('passed')
    expect(batch.checks.find(c => c.kind === 'asset-check')!.status).toBe('passed')
    expect(isReleasable(batch, state.drafts, v1)).toBe(false)
  })

  it('答案变化只让相关检查过期，旧证据保留', () => {
    const states = checkStates(batch, fixedEu, v1)
    expect(states.find(s => s.kind === 'completeness')!.stale).toBe(true)
    expect(states.find(s => s.kind === 'content-review')!.stale).toBe(true)
    expect(states.find(s => s.kind === 'asset-check')!.stale).toBe(false)
    // 冻结时的证据记录仍在，未被改写
    expect(batch.checks.find(c => c.kind === 'completeness')!.detail).toContain('欧盟')
    expect(batch.snapshot['d_android_eu'].answers['q_region_note']).toBeUndefined()
  })

  it('素材变化只让素材检查过期', () => {
    const drafts = state.drafts.map(d =>
      d.id === 'd_android_us' ? { ...d, assets: d.assets.filter(a => a.kind !== 'screenshot') } : d,
    )
    const states = checkStates(batch, drafts, v1)
    expect(states.find(s => s.kind === 'asset-check')!.stale).toBe(true)
    expect(states.find(s => s.kind === 'completeness')!.stale).toBe(false)
    expect(states.find(s => s.kind === 'content-review')!.stale).toBe(false)
  })

  it('补齐答案并重新检查后恢复可发布', () => {
    let b = rerunCheck(batch, 'completeness', fixedEu, v1, 2000)
    b = rerunCheck(b, 'content-review', fixedEu, v1, 2000)
    expect(isReleasable(b, fixedEu, v1)).toBe(true)
  })
})

describe('审核结果', () => {
  it('实时结果被采纳', () => {
    const result: ReviewResult = {
      id: 'rv_1',
      batchId: batch.id,
      kind: 'content-review',
      verdict: 'approved',
      fingerprint: currentFingerprint(batch, state.drafts),
      receivedAt: 3000,
    }
    const { batches, entry } = ingestReviewResult(state.batches, result, state.drafts, state.formVersions, [], 3000)
    expect(entry.outcome).toBe('applied')
    expect(batches[0].appliedReviews).toHaveLength(1)
  })

  it('迟到结果不能放行批次', () => {
    const staleFingerprint = currentFingerprint(batch, state.drafts)
    const changed = withAnswer(state.drafts, 'd_android_us', 'q_support', 'https://new.example.com')
    const result: ReviewResult = {
      id: 'rv_late',
      batchId: batch.id,
      kind: 'content-review',
      verdict: 'approved',
      fingerprint: staleFingerprint,
      receivedAt: 3000,
    }
    const { batches, entry } = ingestReviewResult(state.batches, result, changed, state.formVersions, [], 3000)
    expect(entry.outcome).toBe('late')
    expect(batches[0].appliedReviews).toHaveLength(0)
    expect(batches[0].checks.find(c => c.kind === 'content-review')!.ranAt).not.toBe(3000)
    expect(isReleasable(batches[0], changed, v1)).toBe(false)
  })

  it('重复结果被忽略', () => {
    const result: ReviewResult = {
      id: 'rv_dup',
      batchId: batch.id,
      kind: 'content-review',
      verdict: 'approved',
      fingerprint: currentFingerprint(batch, state.drafts),
      receivedAt: 3000,
    }
    const first = ingestReviewResult(state.batches, result, state.drafts, state.formVersions, [], 3000)
    expect(first.entry.outcome).toBe('applied')

    // 同一结果再次送达
    const second = ingestReviewResult(first.batches, result, state.drafts, state.formVersions, [first.entry], 3001)
    expect(second.entry.outcome).toBe('duplicate')

    // 不同 id 但同批次同类型也算重复
    const third = ingestReviewResult(
      first.batches,
      { ...result, id: 'rv_dup_2' },
      state.drafts,
      state.formVersions,
      [first.entry],
      3002,
    )
    expect(third.entry.outcome).toBe('duplicate')
    expect(third.batches[0].appliedReviews).toHaveLength(1)
  })

  it('驳回结果使对应检查失败', () => {
    const result: ReviewResult = {
      id: 'rv_rej',
      batchId: batch.id,
      kind: 'content-review',
      verdict: 'rejected',
      fingerprint: currentFingerprint(batch, state.drafts),
      receivedAt: 3000,
    }
    const { batches, entry } = ingestReviewResult(state.batches, result, state.drafts, state.formVersions, [], 3000)
    expect(entry.outcome).toBe('applied')
    expect(batches[0].checks.find(c => c.kind === 'content-review')!.status).toBe('failed')
    expect(isReleasable(batches[0], state.drafts, v1)).toBe(false)
  })

  it('旧批次的审核结果不影响新批次', () => {
    // 修复问题后冻结新批次
    const newBatch = freezeBatch('b_new', '修复后批次', fixedEu.map(d => d.id), fixedEu, v1, 4000)
    expect(isReleasable(newBatch, fixedEu, v1)).toBe(true)

    // 旧批次收到一条针对当前内容的审核通过结果
    const result: ReviewResult = {
      id: 'rv_old',
      batchId: batch.id,
      kind: 'content-review',
      verdict: 'approved',
      fingerprint: currentFingerprint(batch, fixedEu),
      receivedAt: 5000,
    }
    const { batches, entry } = ingestReviewResult([batch, newBatch], result, fixedEu, state.formVersions, [], 5000)
    expect(entry.outcome).toBe('applied')
    const untouched = batches.find(b => b.id === 'b_new')!
    expect(untouched.appliedReviews).toHaveLength(0)
    expect(isReleasable(untouched, fixedEu, v1)).toBe(true)
  })

  it('未知批次的结果只记录不采纳', () => {
    const result: ReviewResult = {
      id: 'rv_unknown',
      batchId: 'b_missing',
      kind: 'content-review',
      verdict: 'approved',
      fingerprint: 'whatever',
      receivedAt: 3000,
    }
    const { batches, entry } = ingestReviewResult(state.batches, result, state.drafts, state.formVersions, [], 3000)
    expect(entry.outcome).toBe('unknown-batch')
    expect(batches).toBe(state.batches)
  })
})
