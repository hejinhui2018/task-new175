import { useState } from 'react'
import { PLATFORMS, REGIONS } from '../domain/constants'
import { analyzeImpact, diffFormVersions, type QuestionChange } from '../domain/forms'
import type { FormVersion, Question, QuestionCondition, QuestionType } from '../domain/types'
import { clone, newId } from '../domain/util'
import { useAppStore } from '../state/store'
import { conditionSummary, formatTime, platformLabel, regionLabel, Tag, TYPE_LABELS } from './ui'

export function VersionsPanel() {
  const { state, dispatch } = useAppStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingBaseId, setEditingBaseId] = useState<string | null>(null)

  const selected =
    state.formVersions.find(v => v.id === selectedId) ??
    state.formVersions.find(v => v.id === state.currentFormVersionId)!
  const editingBase = editingBaseId ? state.formVersions.find(v => v.id === editingBaseId) : undefined

  return (
    <div className="panel-grid">
      <section className="card">
        <h3>表单版本</h3>
        <p className="hint">版本一旦保存即不可变；修改请「以此为基础新建版本」，出错可回退。</p>
        {state.formVersions.map(v => (
          <div
            key={v.id}
            className={v.id === selected.id ? 'version-card selected' : 'version-card'}
            onClick={() => setSelectedId(v.id)}
          >
            <div className="version-head">
              <strong>{v.label}</strong>
              {v.id === state.currentFormVersionId && <Tag tone="green">当前</Tag>}
            </div>
            <div className="muted">
              {v.questions.length} 道题 · {formatTime(v.createdAt)}
            </div>
            {v.note && <div className="muted">{v.note}</div>}
            <div className="row-actions" onClick={e => e.stopPropagation()}>
              <button className="btn btn-small" onClick={() => setEditingBaseId(v.id)}>
                以此为基础新建版本
              </button>
              {v.id !== state.currentFormVersionId && (
                <>
                  <button className="btn btn-small" onClick={() => dispatch({ type: 'version/setCurrent', versionId: v.id })}>
                    设为当前
                  </button>
                  <button
                    className="btn btn-small"
                    onClick={() => {
                      if (window.confirm(`回退到「${v.label}」？将生成内容相同的新版本并设为当前。`)) {
                        dispatch({ type: 'version/rollback', versionId: v.id })
                      }
                    }}
                  >
                    回退到此版本
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="card grow">
        {editingBase ? (
          <VersionEditor base={editingBase} onClose={() => setEditingBaseId(null)} />
        ) : (
          <>
            <VersionDetail version={selected} />
            <DiffView versions={state.formVersions} />
          </>
        )}
      </section>
    </div>
  )
}

function VersionDetail({ version }: { version: FormVersion }) {
  return (
    <div>
      <h3>{version.label}</h3>
      <table className="table">
        <thead>
          <tr>
            <th>题目</th>
            <th>类型</th>
            <th>必填</th>
            <th>选项</th>
            <th>条件</th>
            <th>来源</th>
          </tr>
        </thead>
        <tbody>
          {version.questions.map(q => (
            <tr key={q.id}>
              <td>{q.title}</td>
              <td>{TYPE_LABELS[q.type]}</td>
              <td>{q.required ? '必填' : '选答'}</td>
              <td>{q.options.length > 0 ? q.options.map(o => o.label).join(' / ') : '—'}</td>
              <td>{conditionSummary(q, version)}</td>
              <td>{q.splitFrom ? `拆分自 ${q.splitFrom}` : q.replaces ? `替换 ${q.replaces}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DiffView({ versions }: { versions: FormVersion[] }) {
  const { state } = useAppStore()
  const [aId, setAId] = useState(versions[0]?.id ?? '')
  const [bId, setBId] = useState(versions[versions.length - 1]?.id ?? '')
  const a = versions.find(v => v.id === aId)
  const b = versions.find(v => v.id === bId)

  return (
    <div className="diff">
      <h3>版本对比</h3>
      <div className="diff-picker">
        <select value={aId} onChange={e => setAId(e.target.value)}>
          {versions.map(v => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <span>→</span>
        <select value={bId} onChange={e => setBId(e.target.value)}>
          {versions.map(v => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      {!a || !b || a.id === b.id ? (
        <p className="hint">选择两个不同的版本进行对比。</p>
      ) : (
        <DiffResult a={a} b={b} />
      )}
    </div>
  )
}

function DiffResult({ a, b }: { a: FormVersion; b: FormVersion }) {
  const { state } = useAppStore()
  const diff = diffFormVersions(a, b)
  const impacts = analyzeImpact(diff, state.drafts)
  const draftById = new Map(state.drafts.map(d => [d.id, d]))

  return (
    <div>
      {diff.changes.length === 0 && <p className="hint">两个版本的题目完全一致。</p>}
      <ul className="change-list">
        {diff.changes.map((ch, i) => (
          <ChangeRow key={i} change={ch} />
        ))}
      </ul>
      <h4>影响评估（{impacts.length} 份草稿受影响）</h4>
      {impacts.length === 0 && <p className="hint">没有草稿受到这些变化的影响。</p>}
      {impacts.map(imp => {
        const d = draftById.get(imp.draftId)
        if (!d) return null
        return (
          <div key={imp.draftId} className="impact-item">
            <strong>
              {d.appName} · {platformLabel(d.platform)}/{regionLabel(d.region)}
            </strong>
            <ul>
              {imp.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function ChangeRow({ change }: { change: QuestionChange }) {
  switch (change.kind) {
    case 'split':
      return (
        <li>
          <Tag tone="purple">拆分</Tag>「{change.from.title}」拆分为：
          {change.into.map(q => q.title).join('、')}
        </li>
      )
    case 'removed':
      return (
        <li>
          <Tag tone="red">移除</Tag>「{change.question.title}」
        </li>
      )
    case 'added':
      return (
        <li>
          <Tag tone="blue">新增</Tag>「{change.question.title}」
          {change.question.required && <Tag tone="amber">必填</Tag>}
          <span className="muted">（{conditionSummary(change.question)}）</span>
        </li>
      )
    case 'replaced':
      return (
        <li>
          <Tag tone="amber">替换</Tag>「{change.from.title}」→「{change.to.title}」
          <span className="muted">（{change.notes.join('、')}）</span>
        </li>
      )
    case 'modified': {
      const tags: string[] = []
      if (change.optionsAdded.length > 0) tags.push(`新增选项 ${change.optionsAdded.map(o => o.label).join('、')}`)
      if (change.optionsRemoved.length > 0) tags.push(`移除选项 ${change.optionsRemoved.map(o => o.label).join('、')}`)
      if (change.conditionChanged) tags.push('条件调整')
      if (change.typeChanged) tags.push('类型变化')
      if (change.requiredChanged) tags.push('必填变化')
      if (change.retitled) tags.push(`改名「${change.after.title}」`)
      return (
        <li>
          <Tag tone="amber">修改</Tag>「{change.before.title}」
          <span className="muted">（{tags.join('；')}）</span>
        </li>
      )
    }
  }
}

// ---------- 版本编辑器 ----------

function VersionEditor({ base, onClose }: { base: FormVersion; onClose: () => void }) {
  const { dispatch } = useAppStore()
  const [label, setLabel] = useState(`${base.label} · 修订`)
  const [note, setNote] = useState('')
  const [questions, setQuestions] = useState<Question[]>(() => clone(base.questions))

  const update = (id: string, patch: Partial<Question>) => {
    setQuestions(qs => qs.map(q => (q.id === id ? { ...q, ...patch } : q)))
  }

  const save = () => {
    dispatch({
      type: 'version/add',
      version: {
        id: newId('fv'),
        label: label.trim() || '未命名版本',
        note: note.trim() || undefined,
        createdAt: Date.now(),
        questions,
      },
      makeCurrent: true,
    })
    onClose()
  }

  return (
    <div>
      <h3>基于「{base.label}」新建版本</h3>
      <div className="form-row">
        <label>
          版本名称
          <input value={label} onChange={e => setLabel(e.target.value)} />
        </label>
        <label>
          备注
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="本次修改说明" />
        </label>
      </div>
      {questions.map((q, idx) => (
        <QuestionEditor
          key={q.id}
          q={q}
          all={questions}
          baseQuestions={base.questions}
          onChange={patch => update(q.id, patch)}
          onRemove={() => setQuestions(qs => qs.filter(x => x.id !== q.id))}
          onMove={dir => {
            const j = idx + dir
            if (j < 0 || j >= questions.length) return
            setQuestions(qs => {
              const next = [...qs]
              ;[next[idx], next[j]] = [next[j], next[idx]]
              return next
            })
          }}
        />
      ))}
      <div className="row-actions">
        <button
          className="btn"
          onClick={() =>
            setQuestions(qs => [...qs, { id: newId('q'), title: '新问题', type: 'text', required: false, options: [] }])
          }
        >
          添加问题
        </button>
        <button className="btn btn-primary" onClick={save}>
          保存为新版本并设为当前
        </button>
        <button className="btn" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  )
}

function QuestionEditor({
  q,
  all,
  baseQuestions,
  onChange,
  onRemove,
  onMove,
}: {
  q: Question
  all: Question[]
  baseQuestions: Question[]
  onChange: (patch: Partial<Question>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const setCondition = (patch: Partial<QuestionCondition>) => {
    const next: QuestionCondition = { ...q.condition, ...patch }
    if (!next.platforms || next.platforms.length === 0) delete next.platforms
    if (!next.regions || next.regions.length === 0) delete next.regions
    if (!next.dependsOn) delete next.dependsOn
    onChange({ condition: Object.keys(next).length > 0 ? next : undefined })
  }

  const toggleIn = (list: string[] | undefined, id: string): string[] =>
    list?.includes(id) ? list.filter(x => x !== id) : [...(list ?? []), id]

  const depParent = q.condition?.dependsOn
    ? all.find(x => x.id === q.condition!.dependsOn!.questionId)
    : undefined

  return (
    <div className="question-editor">
      <div className="form-row">
        <label className="grow">
          标题
          <input value={q.title} onChange={e => onChange({ title: e.target.value })} />
        </label>
        <label>
          类型
          <select value={q.type} onChange={e => onChange({ type: e.target.value as QuestionType })}>
            {Object.entries(TYPE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          <input type="checkbox" checked={q.required} onChange={e => onChange({ required: e.target.checked })} />
          必填
        </label>
      </div>

      {(q.type === 'single' || q.type === 'multi') && (
        <div className="options-editor">
          {q.options.map((o, idx) => (
            <div key={idx} className="option-row">
              <input
                value={o.id}
                placeholder="选项 id"
                onChange={e =>
                  onChange({ options: q.options.map((x, i) => (i === idx ? { ...x, id: e.target.value } : x)) })
                }
              />
              <input
                value={o.label}
                placeholder="选项文案"
                onChange={e =>
                  onChange({ options: q.options.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)) })
                }
              />
              <button className="btn btn-small" onClick={() => onChange({ options: q.options.filter((_, i) => i !== idx) })}>
                删除
              </button>
            </div>
          ))}
          <button
            className="btn btn-small"
            onClick={() => onChange({ options: [...q.options, { id: newId('opt'), label: '新选项' }] })}
          >
            添加选项
          </button>
        </div>
      )}

      <div className="condition-editor">
        <div className="chip-row">
          <span className="muted">平台：</span>
          {PLATFORMS.map(p => (
            <label key={p.id} className="inline">
              <input
                type="checkbox"
                checked={q.condition?.platforms?.includes(p.id) ?? false}
                onChange={() => setCondition({ platforms: toggleIn(q.condition?.platforms, p.id) })}
              />
              {p.label}
            </label>
          ))}
          <span className="muted">（不勾 = 全部）</span>
        </div>
        <div className="chip-row">
          <span className="muted">地区：</span>
          {REGIONS.map(r => (
            <label key={r.id} className="inline">
              <input
                type="checkbox"
                checked={q.condition?.regions?.includes(r.id) ?? false}
                onChange={() => setCondition({ regions: toggleIn(q.condition?.regions, r.id) })}
              />
              {r.label}
            </label>
          ))}
          <span className="muted">（不勾 = 全部）</span>
        </div>
        <div className="chip-row">
          <span className="muted">依赖：</span>
          <select
            value={q.condition?.dependsOn?.questionId ?? ''}
            onChange={e => {
              const pid = e.target.value
              if (!pid) setCondition({ dependsOn: undefined })
              else {
                const parent = all.find(x => x.id === pid)
                const first =
                  parent?.type === 'boolean' ? 'true' : parent?.options[0]?.id ?? ''
                setCondition({ dependsOn: { questionId: pid, equals: first } })
              }
            }}
          >
            <option value="">无依赖</option>
            {all
              .filter(x => x.id !== q.id && x.type !== 'text')
              .map(x => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
          </select>
          {q.condition?.dependsOn && depParent && (
            <select
              value={q.condition.dependsOn.equals}
              onChange={e => setCondition({ dependsOn: { ...q.condition!.dependsOn!, equals: e.target.value } })}
            >
              {depParent.type === 'boolean' ? (
                <>
                  <option value="true">是</option>
                  <option value="false">否</option>
                </>
              ) : (
                depParent.options.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))
              )}
            </select>
          )}
        </div>
        <div className="chip-row">
          <span className="muted">来源：</span>
          <select
            value={q.splitFrom ?? ''}
            onChange={e => onChange({ splitFrom: e.target.value || undefined, replaces: e.target.value ? undefined : q.replaces })}
          >
            <option value="">（非拆分）</option>
            {baseQuestions.map(bq => (
              <option key={bq.id} value={bq.id}>
                拆分自：{bq.title}
              </option>
            ))}
          </select>
          <select
            value={q.replaces ?? ''}
            onChange={e => onChange({ replaces: e.target.value || undefined, splitFrom: e.target.value ? undefined : q.splitFrom })}
          >
            <option value="">（非替换）</option>
            {baseQuestions.map(bq => (
              <option key={bq.id} value={bq.id}>
                替换：{bq.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row-actions">
        <button className="btn btn-small" onClick={() => onMove(-1)}>
          上移
        </button>
        <button className="btn btn-small" onClick={() => onMove(1)}>
          下移
        </button>
        <button className="btn btn-small btn-danger" onClick={onRemove}>
          删除此题
        </button>
      </div>
    </div>
  )
}
