import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from './App'
import { BatchesPanel } from './components/BatchesPanel'
import { DraftsPanel } from './components/DraftsPanel'
import { MigrationPanel } from './components/MigrationPanel'
import { VersionsPanel } from './components/VersionsPanel'

describe('应用冒烟', () => {
  it('整体应用可渲染', () => {
    const html = renderToString(<App />)
    expect(html).toContain('StoreDraft')
    expect(html).toContain('表单版本')
    expect(html).toContain('提交批次')
  })

  it('版本面板渲染版本列表与对比', () => {
    const html = renderToString(<VersionsPanel />)
    expect(html).toContain('v1 · 2025 资料表')
    expect(html).toContain('v2 · 2026 多地区资料表')
    expect(html).toContain('影响评估')
  })

  it('草稿面板渲染条件分支与缺失提示', () => {
    const html = renderToString(<DraftsPanel />)
    expect(html).toContain('FocusFlow')
    expect(html).toContain('素材引用')
  })

  it('迁移面板渲染版本选择', () => {
    const html = renderToString(<MigrationPanel />)
    expect(html).toContain('迁移设置')
  })

  it('批次面板渲染检查记录与审核模拟', () => {
    const html = renderToString(<BatchesPanel />)
    expect(html).toContain('2026-09 首发批次')
    expect(html).toContain('完整性')
    expect(html).toContain('模拟审核结果送达')
  })
})
