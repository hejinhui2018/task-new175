import { useEffect, useState } from 'react'
import { BatchesPanel } from './components/BatchesPanel'
import { DraftsPanel } from './components/DraftsPanel'
import { MigrationPanel } from './components/MigrationPanel'
import { TopBar } from './components/TopBar'
import { VersionsPanel } from './components/VersionsPanel'
import { appStore } from './state/store'

type TabId = 'versions' | 'drafts' | 'migration' | 'batches'

const TABS: { id: TabId; label: string }[] = [
  { id: 'versions', label: '表单版本' },
  { id: 'drafts', label: '草稿' },
  { id: 'migration', label: '迁移' },
  { id: 'batches', label: '提交批次' },
]

export default function App() {
  const [tab, setTab] = useState<TabId>('versions')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) appStore.redo()
        else appStore.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <TopBar />
      <nav className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'versions' && <VersionsPanel />}
        {tab === 'drafts' && <DraftsPanel />}
        {tab === 'migration' && <MigrationPanel />}
        {tab === 'batches' && <BatchesPanel />}
      </main>
    </div>
  )
}
