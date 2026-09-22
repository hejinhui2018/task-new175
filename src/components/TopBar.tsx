import { createSampleState } from '../domain/sample'
import { useAppStore } from '../state/store'

export function TopBar() {
  const { canUndo, canRedo, undoDepth, redoDepth, dispatch, undo, redo } = useAppStore()
  return (
    <header className="topbar">
      <div className="brand">
        StoreDraft <span>上架资料换版台</span>
      </div>
      <div className="topbar-actions">
        <span className="autosave">已自动保存 · 刷新后自动恢复</span>
        <button className="btn" disabled={!canUndo} onClick={undo} title="Ctrl/⌘+Z">
          撤销（{undoDepth}）
        </button>
        <button className="btn" disabled={!canRedo} onClick={redo} title="Ctrl/⌘+Shift+Z">
          重做（{redoDepth}）
        </button>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm('确定要丢弃全部修改并恢复内置样例吗？（此操作本身也可撤销）')) {
              dispatch({ type: 'state/replace', state: createSampleState() })
            }
          }}
        >
          重置为样例
        </button>
      </div>
    </header>
  )
}
