import { describe, expect, it } from 'vitest'
import { buildMigrationPlan } from '../domain/migration'
import { createSampleState } from '../domain/sample'
import { MemoryStorage, Store } from './store'

const KEY = 'test-key'

function supportValue(store: Store) {
  return store.present.drafts.find(d => d.id === 'd_android_us')!.answers['q_support']?.value
}

describe('撤销与重做', () => {
  it('修改答案可撤销、可重做', () => {
    const s = new Store(new MemoryStorage(), KEY)
    const before = supportValue(s)
    s.dispatch({ type: 'answer/set', draftId: 'd_android_us', questionId: 'q_support', value: 'https://x.example.com', at: 1 })
    expect(supportValue(s)).toBe('https://x.example.com')
    s.undo()
    expect(supportValue(s)).toBe(before)
    s.redo()
    expect(supportValue(s)).toBe('https://x.example.com')
  })

  it('迁移也可撤销', () => {
    const s = new Store(new MemoryStorage(), KEY)
    const [v1, v2] = s.present.formVersions
    const plan = buildMigrationPlan(v1, v2, 'mp', 1)
    s.dispatch({ type: 'migration/apply', plan, draftIds: ['d_ios_us'], at: 2 })
    expect(s.present.drafts.find(d => d.id === 'd_ios_us')!.formVersionId).toBe('fv_v2')
    s.undo()
    expect(s.present.drafts.find(d => d.id === 'd_ios_us')!.formVersionId).toBe('fv_v1')
  })

  it('部分迁移指令只迁移选中草稿', () => {
    const s = new Store(new MemoryStorage(), KEY)
    const [v1, v2] = s.present.formVersions
    const plan = buildMigrationPlan(v1, v2, 'mp', 1)
    s.dispatch({ type: 'migration/apply', plan, draftIds: ['d_ios_us'], at: 2 })
    expect(s.present.drafts.find(d => d.id === 'd_ios_us')!.formVersionId).toBe('fv_v2')
    expect(s.present.drafts.find(d => d.id === 'd_android_eu')!.formVersionId).toBe('fv_v1')
    expect(s.present.drafts.find(d => d.id === 'd_android_kr')!.formVersionId).toBe('fv_v1')
  })
})

describe('刷新恢复', () => {
  it('持久化后新实例完整恢复（含撤销历史）', () => {
    const storage = new MemoryStorage()
    const a = new Store(storage, KEY)
    a.dispatch({ type: 'version/setCurrent', versionId: 'fv_v1', at: 1 })
    a.dispatch({ type: 'answer/set', draftId: 'd_android_us', questionId: 'q_support', value: 'https://x.example.com', at: 2 })
    a.dispatch({ type: 'batch/freeze', label: '测试批次', draftIds: ['d_android_us'], at: 3 })
    expect(a.present.batches).toHaveLength(2)

    const b = new Store(storage, KEY)
    expect(b.present).toEqual(a.present)
    expect(b.canUndo).toBe(true)
    b.undo() // 撤销冻结
    expect(b.present.batches).toHaveLength(1)
    b.undo() // 撤销改答案
    expect(b.present.drafts.find(d => d.id === 'd_android_us')!.answers['q_support']?.value).toBe(
      'https://focusflow.example/support',
    )
  })

  it('损坏的存档回退到内置样例', () => {
    const storage = new MemoryStorage()
    storage.setItem(KEY, '{not valid json')
    const s = new Store(storage, KEY)
    expect(s.present.formVersions.map(v => v.id)).toEqual(['fv_v1', 'fv_v2'])
    expect(s.present.drafts).toHaveLength(5)
    expect(s.present.batches).toHaveLength(1)
  })

  it('重置为样例本身也可撤销', () => {
    const s = new Store(new MemoryStorage(), KEY)
    s.dispatch({ type: 'answer/set', draftId: 'd_android_us', questionId: 'q_support', value: 'https://x.example.com', at: 1 })
    s.dispatch({ type: 'state/replace', state: createSampleState() })
    expect(supportValue(s)).toBe('https://focusflow.example/support')
    s.undo()
    expect(supportValue(s)).toBe('https://x.example.com')
  })
})
