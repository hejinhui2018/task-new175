import { describe, expect, it } from 'vitest'
import {
  analyzeImpact,
  answerValues,
  diffFormVersions,
  isQuestionVisible,
  missingRequired,
  visibleQuestions,
  type QuestionChange,
} from './forms'
import { createSampleState } from './sample'

const state = createSampleState()
const [v1, v2] = state.formVersions

function draft(id: string) {
  const d = state.drafts.find(x => x.id === id)
  if (!d) throw new Error(`missing draft ${id}`)
  return d
}

describe('条件分支', () => {
  it('按平台与地区过滤题目', () => {
    const androidEU = visibleQuestions(v2, {
      platform: 'android',
      region: 'EU',
      answers: { q_data_collect: true },
    }).map(q => q.id)
    expect(androidEU).toContain('q_android_safety')
    expect(androidEU).toContain('q_region_decl')
    expect(androidEU).toContain('q_data_types')
    expect(androidEU).not.toContain('q_ios_att')

    const iosUS = visibleQuestions(v2, {
      platform: 'ios',
      region: 'US',
      answers: { q_data_collect: false },
    }).map(q => q.id)
    expect(iosUS).toContain('q_ios_att')
    expect(iosUS).not.toContain('q_android_safety')
    expect(iosUS).not.toContain('q_region_decl')
    expect(iosUS).not.toContain('q_data_types')
  })

  it('依赖题随父答案出现与隐藏', () => {
    const q = v2.questions.find(x => x.id === 'q_data_types')!
    const base = { platform: 'ios', region: 'US' }
    expect(isQuestionVisible(q, { ...base, answers: { q_data_collect: true } })).toBe(true)
    expect(isQuestionVisible(q, { ...base, answers: { q_data_collect: false } })).toBe(false)
    expect(isQuestionVisible(q, { ...base, answers: {} })).toBe(false)
  })

  it('完整性只统计条件命中的必填题', () => {
    const eu = draft('d_android_eu')
    const missEU = missingRequired(v1, {
      platform: eu.platform,
      region: eu.region,
      answers: answerValues(eu.answers),
    })
    expect(missEU.map(q => q.id)).toEqual(['q_region_note'])

    const us = draft('d_android_us')
    const missUS = missingRequired(v1, {
      platform: us.platform,
      region: us.region,
      answers: answerValues(us.answers),
    })
    expect(missUS).toEqual([])
  })
})

describe('版本对比', () => {
  const diff = diffFormVersions(v1, v2)

  it('识别题目拆分', () => {
    const split = diff.changes.find((c): c is Extract<QuestionChange, { kind: 'split' }> => c.kind === 'split')
    expect(split).toBeDefined()
    expect(split!.from.id).toBe('q_privacy_collect')
    expect(split!.into.map(q => q.id)).toEqual(['q_data_collect', 'q_data_types', 'q_data_ads'])
  })

  it('识别选项变化', () => {
    const mod = diff.changes.find(
      (c): c is Extract<QuestionChange, { kind: 'modified' }> => c.kind === 'modified' && c.before.id === 'q_crash',
    )
    expect(mod).toBeDefined()
    expect(mod!.optionsRemoved.map(o => o.id)).toEqual(['ask'])
  })

  it('识别条件调整（替换）', () => {
    const rep = diff.changes.find(
      (c): c is Extract<QuestionChange, { kind: 'replaced' }> => c.kind === 'replaced' && c.from.id === 'q_region_note',
    )
    expect(rep).toBeDefined()
    expect(rep!.to.id).toBe('q_region_decl')
    expect(rep!.notes).toContain('条件调整')
  })

  it('识别新增必填题', () => {
    const added = diff.changes
      .filter((c): c is Extract<QuestionChange, { kind: 'added' }> => c.kind === 'added')
      .map(c => c.question.id)
    expect(added).toContain('q_android_safety')
    expect(added).toContain('q_ios_att')
  })

  it('影响评估命中相关草稿', () => {
    const impacts = analyzeImpact(diff, state.drafts)

    const kr = impacts.find(i => i.draftId === 'd_android_kr')
    expect(kr?.reasons.some(r => r.includes('条件调整'))).toBe(true)

    const iosUS = impacts.find(i => i.draftId === 'd_ios_us')
    expect(iosUS?.reasons.some(r => r.includes('已选选项被移除'))).toBe(true)

    const androidUS = impacts.find(i => i.draftId === 'd_android_us')
    expect(androidUS?.reasons.some(r => r.includes('新增必填'))).toBe(true)

    // 已迁移到其他版本的草稿不参与评估（此处全部在 v1，共 5 份都受影响）
    expect(impacts.every(i => state.drafts.some(d => d.id === i.draftId))).toBe(true)
  })
})
