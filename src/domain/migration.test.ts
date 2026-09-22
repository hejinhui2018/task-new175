import { describe, expect, it } from 'vitest'
import { applyMigrationToDraft, buildMigrationPlan, previewMigration } from './migration'
import { createSampleState } from './sample'

const state = createSampleState()
const [v1, v2] = state.formVersions
const plan = buildMigrationPlan(v1, v2, 'mp_test', 1000)

function draft(id: string) {
  const d = state.drafts.find(x => x.id === id)
  if (!d) throw new Error(`missing draft ${id}`)
  return d
}

describe('迁移计划', () => {
  it('拆分：隐私说明拆到条件问题，主答案去布尔门槛题', () => {
    const m = plan.mappings.find(x => x.fromQuestionId === 'q_privacy_collect')!
    expect(m.action).toBe('split')
    expect(m.targets).toEqual(['q_data_collect'])
    expect(m.splitInto).toEqual(['q_data_collect', 'q_data_types', 'q_data_ads'])
    expect(m.optionRemap).toMatchObject({ none: 'false', anonymous: 'true', personal: 'true' })
  })

  it('替换与沿用：地区声明、分析级别、支持链接', () => {
    const note = plan.mappings.find(x => x.fromQuestionId === 'q_region_note')!
    expect(note.action).toBe('carry')
    expect(note.targets).toEqual(['q_region_decl'])

    const analytics = plan.mappings.find(x => x.fromQuestionId === 'q_analytics')!
    expect(analytics.targets).toEqual(['q_analytics_level'])
    expect(analytics.optionRemap).toMatchObject({ false: 'off', true: 'anonymous' })

    const support = plan.mappings.find(x => x.fromQuestionId === 'q_support')!
    expect(support.action).toBe('carry')
    expect(support.targets).toEqual(['q_support'])
  })
})

describe('迁移预览', () => {
  it('说明答案去向并标记待补题', () => {
    const p = previewMigration(plan, draft('d_ios_us'), v1, v2)
    expect(p.carried.some(c => c.toQuestionId === 'q_support')).toBe(true)
    expect(p.remapped.some(r => r.toQuestionId === 'q_data_collect' && r.toValue === true)).toBe(true)
    expect(p.remapped.some(r => r.toQuestionId === 'q_analytics_level' && r.toValue === 'anonymous')).toBe(true)
    expect(p.missing).toContain('q_data_types')
    expect(p.missing).toContain('q_data_ads')
    expect(p.missing).toContain('q_ios_att')
    expect(p.missing).not.toContain('q_region_decl') // 美国不适用地区声明
  })

  it('条件扩展：韩国草稿迁移后需要补地区声明', () => {
    const p = previewMigration(plan, draft('d_android_kr'), v1, v2)
    expect(p.missing).toContain('q_region_decl')
    expect(p.missing).toContain('q_android_safety')
    expect(p.missing).not.toContain('q_data_types') // 不收集数据，依赖题隐藏
  })
})

describe('答案冲突', () => {
  it('已移除选项产生冲突且不被携带，旧答案归档', () => {
    const iosUS = draft('d_ios_us')
    const p = previewMigration(plan, iosUS, v1, v2)
    expect(p.conflicts.some(c => c.questionId === 'q_crash')).toBe(true)

    const migrated = applyMigrationToDraft(plan, iosUS, v1, v2, 1000)
    expect(migrated.answers['q_crash']).toBeUndefined()
    expect(migrated.lastMigration?.archived['q_crash']?.value).toBe('ask')
  })

  it('补充映射后冲突消除', () => {
    const fixed = {
      ...plan,
      mappings: plan.mappings.map(m =>
        m.fromQuestionId === 'q_crash' ? { ...m, optionRemap: { ...m.optionRemap, ask: 'never' } } : m,
      ),
    }
    const iosUS = draft('d_ios_us')
    const p = previewMigration(fixed, iosUS, v1, v2)
    expect(p.conflicts).toHaveLength(0)

    const migrated = applyMigrationToDraft(fixed, iosUS, v1, v2, 1000)
    expect(migrated.answers['q_crash']?.value).toBe('never')
    expect(migrated.answers['q_crash']?.source).toBe('migrated')
  })
})

describe('部分迁移', () => {
  it('只迁移选中的草稿，未选草稿保持原样', () => {
    const selected = new Set(['d_ios_us', 'd_android_kr'])
    const migrated = state.drafts.map(d =>
      selected.has(d.id) ? applyMigrationToDraft(plan, d, v1, v2, 1000) : d,
    )

    const moved = migrated.find(d => d.id === 'd_ios_us')!
    expect(moved.formVersionId).toBe('fv_v2')
    expect(moved.answers['q_data_collect']?.value).toBe(true)

    const untouched = migrated.find(d => d.id === 'd_android_eu')!
    expect(untouched).toBe(draft('d_android_eu')) // 同一引用，完全未动
    expect(untouched.formVersionId).toBe('fv_v1')
  })
})
