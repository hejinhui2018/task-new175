import { useState } from 'react';
import { useAppState, useStore } from './state/store';
import { VersionsView } from './views/VersionsView';
import { DraftsView } from './views/DraftsView';
import { CompareView } from './views/CompareView';
import { MigrationView } from './views/MigrationView';
import { BatchesView } from './views/BatchesView';
import { clearState } from './state/persistence';

type Tab = 'versions' | 'drafts' | 'compare' | 'migration' | 'batches';

const TABS: { id: Tab; label: string }[] = [
  { id: 'versions', label: '表单版本' },
  { id: 'drafts', label: '草稿资料' },
  { id: 'compare', label: '版本对比' },
  { id: 'migration', label: '迁移换版' },
  { id: 'batches', label: '提交批次' },
];

export default function App() {
  const state = useAppState();
  const store = useStore();
  const [tab, setTab] = useState<Tab>('drafts');
  const [selectedDraftId, setSelectedDraftId] = useState<string | undefined>();

  const activeVersion = state.versions.find((v) => v.id === state.activeVersionId);

  return (
    <>
      <header className="app-header">
        <h1>📦 StoreDraft 上架资料换版台</h1>
        <select
          value={state.activeVersionId}
          onChange={(e) => store.setActiveVersion(e.target.value)}
          title="当前表单版本"
        >
          {state.versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <span className="last-action" data-testid="last-action">
          {store.getLastAction()}
        </span>
        <button onClick={() => store.undo()} disabled={!store.canUndo()}>
          ↶ 撤销
        </button>
        <button onClick={() => store.redo()} disabled={!store.canRedo()}>
          ↷ 重做
        </button>
        <button
          className="tiny"
          onClick={() => {
            clearState();
            store.resetSample();
          }}
          title="清空本地恢复数据并重置为内置样例"
        >
          重置样例
        </button>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="page">
        {tab === 'versions' && <VersionsView />}
        {tab === 'drafts' && (
          <DraftsView
            selectedDraftId={selectedDraftId}
            onSelect={setSelectedDraftId}
          />
        )}
        {tab === 'compare' && <CompareView />}
        {tab === 'migration' && (
          <MigrationView
            onGoDraft={setSelectedDraftId}
            onSwitchTab={() => setTab('drafts')}
          />
        )}
        {tab === 'batches' && <BatchesView />}
        {activeVersion?.note && tab !== 'compare' && (
          <p className="muted small" style={{ marginTop: 24 }}>
            当前版本说明：{activeVersion.note}
          </p>
        )}
      </main>
    </>
  );
}
