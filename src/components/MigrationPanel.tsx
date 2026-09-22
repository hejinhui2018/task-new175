import { useEffect, useMemo, useState } from 'react'
import {
  buildMigrationPlan,
  defaultRemap,
  previewMigration,
  type MigrationPlan,
  type QuestionMapping,
} from '../domain/migration'
import type { FormVersion, Question } from '../domain/types'
import { newId } from '../domain/util'
import { useAppStore } from '../state/store'
import { platformLabel, regionLabel, Tag, valueLabel } from './ui'

export function MigrationPanel() {
  const { state, dispatch } = useAppStore()
  const versions = state.formVersions
  const draftVersionIds = new Set(state.drafts.map(d => d.formVersionId))
  const defaultFrom =
    versions.find(v => draftVersionIds.has(v.id) && v.id !== state.currentFormVersionId) ?? versions[0]

  const [fromId, setFromId] = useState(defaultFrom?.id ?? '')
  const [toId, setToId] = useState(state.currentFormVersionId)
  const [plan, setPlan] = useState<MigrationPlan | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [note, setNote] = useState<string | null>(null)

  const from = versions.find(v => v.id === fromId)
  const to = versions.find(v => v.id === toId)

  useEffect(() => {
    if (from && to && from.id !== to.id) {
      setPlan(buildMigrationPlan(from, to, newId('mp'), Date.now()))
      setSelected(new Set())
      setNote(null)
    } else {
      setPlan(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromId, toId])

  const eligible = state.drafts.filter(d => d.formVersionId === fromId)
  const previews = useMemo(
    () => (plan && from && to ? eligible.map(d => previewMigration(plan, d, from, to)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, fromId, toId, state.drafts],
  )

  const updateMapping = (next: QuestionMapping) => {
    setPlan(p => (p ? { ...p, mappings: p.mappings.map(m => (m.fromQuestionId === next.fromQuestionId ? next : m)) } : p))
  }

  const apply = () => {
    if (!plan) return
    const ids = eligible.filter(d => selected.has(d.id)).map(d => d.id)
    if (ids.length === 0) return
    dispatch({ type: 'migration/apply', plan, draftIds: ids })
    setNote(`已迁移 ${ids.length} 份草稿；未选中的 ${eligible.length - ids.length} 份保持原样。`)
    setSelected(new Set())
  }

  return (
    <div className="stack">
      <section className="card">
        <h3>迁移设置</h3>
        <div className="diff-picker">
          <select value={fromId} onChange={e => setFromId(e.target.value)}>
            {versions.map(v => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <span>→</span>
          <select value={toId} onChange={e => setToId(e.target.value)}>
            {versions.map(v => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        {!plan && <p className="hint">请选择两个不同的版本。</p>}
        {plan && from && to && (
          <div className="plan">
            <h4>答案去向（可调整映射）</h4>
            {plan.mappings.map(m => {
              const source = from.questions.find(q => q.id === m.fromQuestionId)
              if (!source) return null
              return <MappingRow key={m.fromQuestionId} mapping={m} source={source} to={to} onChange={updateMapping} />
            })}
          </div>
        )}
      </section>

      {plan && from && to && (
        <section className="card">
          <h3>逐份确认（{eligible.length} 份草稿在 {from.label}）</h3>
          {eligible.length === 0 && <p className="hint">该版本下没有待迁移的草稿。</p>}
          {previews.map(p => {
            const d = eligible.find(x => x.id === p.draftId)!
            return (
              <div key={p.draftId} className="preview-item">
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={selected.has(p.draftId)}
                    onChange={() =>
                      setSelected(s => {
                        const next = new Set(s)
                        if (next.has(p.draftId)) next.delete(p.draftId)
                        else next.add(p.draftId)
                        return next
                      })
                    }
                  />
                  <strong>
                    {d.appName} · {platformLabel(d.platform)}/{regionLabel(d.region)}
                  </strong>
                </label>
                <span className="muted">
                  沿用 {p.carried.length} · 重映射 {p.remapped.length} · 冲突 {p.conflicts.length} · 归档{' '}
                  {p.dropped.length} · 待补 {p.missing.length}
                </span>
                <PreviewDetail plan={plan} from={from} to={to} draftId={p.draftId} />
              </div>
            )
          })}
          <div className="row-actions">
            <button className="btn btn-small" onClick={() => setSelected(new Set(eligible.map(d => d.id)))}>
              全选
            </button>
            <button className="btn btn-small" onClick={() => setSelected(new Set())}>
              全不选
            </button>
            <button className="btn btn-primary" disabled={selected.size === 0} onClick={apply}>
              迁移选中的 {selected.size} 份草稿
            </button>
            {note && <span className="hint">{note}</span>}
          </div>
        </section>
      )}
    </div>
  )
}

function MappingRow({
  mapping,
  source,
  to,
  onChange,
}: {
  mapping: QuestionMapping
  source: Question
  to: FormVersion
  onChange: (m: QuestionMapping) => void
}) {
  const target = mapping.targets.length > 0 ? to.questions.find(q => q.id === mapping.targets[0]) : undefined
  const titleOf = (id: string) => to.questions.find(q => q.id === id)?.title ?? id

  return (
    <div className="mapping-row">
      <div className="mapping-head">
        <strong>{source.title}</strong>
        {mapping.action === 'carry' && <Tag tone="green">沿用</Tag>}
        {mapping.action === 'split' && <Tag tone="purple">拆分</Tag>}
        {mapping.action === 'drop' && <Tag tone="red">移除</Tag>}
        <span className="muted">
          {mapping.action === 'carry' && target && `答案沿用 → 「${target.title}」`}
          {mapping.action === 'split' &&
            `拆分为 ${mapping.splitInto.map(titleOf).join('、')}；主答案 → ${target ? `「${target.title}」` : '（归档）'}，其余新题需补答`}
          {mapping.action === 'drop' && '答案归档，不进入新版本'}
        </span>
      </div>

      {mapping.action === 'split' && (
        <label className="inline">
          主答案去向：
          <select
            value={mapping.targets[0] ?? ''}
            onChange={e => {
              const tid = e.target.value
              const t = to.questions.find(q => q.id === tid)
              onChange({
                ...mapping,
                targets: tid ? [tid] : [],
                optionRemap: t ? defaultRemap(source, t) : {},
              })
            }}
          >
            <option value="">不接收（答案归档）</option>
            {mapping.splitInto.map(id => (
              <option key={id} value={id}>
                {titleOf(id)}
              </option>
            ))}
          </select>
        </label>
      )}

      {target && source.type !== 'text' && target.type !== 'text' && (
        <RemapEditor
          source={source}
          target={target}
          remap={mapping.optionRemap}
          onChange={optionRemap => onChange({ ...mapping, optionRemap })}
        />
      )}
    </div>
  )
}

function RemapEditor({
  source,
  target,
  remap,
  onChange,
}: {
  source: Question
  target: Question
  remap: Record<string, string>
  onChange: (remap: Record<string, string>) => void
}) {
  const sourceOptions =
    source.type === 'boolean'
      ? [
          { id: 'true', label: '是' },
          { id: 'false', label: '否' },
        ]
      : source.options
  const targetOptions =
    target.type === 'boolean'
      ? [
          { id: 'true', label: '是' },
          { id: 'false', label: '否' },
        ]
      : target.options
  if (sourceOptions.length === 0 || targetOptions.length === 0) return null

  return (
    <div className="remap-grid">
      {sourceOptions.map(so => (
        <div key={so.id} className="remap-row">
          <span>{so.label}</span>
          <span>→</span>
          <select
            value={remap[so.id] ?? ''}
            onChange={e => {
              const next = { ...remap }
              if (e.target.value) next[so.id] = e.target.value
              else delete next[so.id]
              onChange(next)
            }}
          >
            <option value="">未映射（作答将冲突）</option>
            {targetOptions.map(to => (
              <option key={to.id} value={to.id}>
                {to.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}

function PreviewDetail({
  plan,
  from,
  to,
  draftId,
}: {
  plan: MigrationPlan
  from: FormVersion
  to: FormVersion
  draftId: string
}) {
  const { state } = useAppStore()
  const draft = state.drafts.find(d => d.id === draftId)
  if (!draft) return null
  const p = previewMigration(plan, draft, from, to)
  const fromTitle = (id: string) => from.questions.find(q => q.id === id)?.title ?? id
  const toTitle = (id: string) => to.questions.find(q => q.id === id)?.title ?? id
  const toQ = (id: string) => to.questions.find(q => q.id === id)

  return (
    <details className="preview-detail">
      <summary>查看答案去向明细</summary>
      {p.remapped.map((r, i) => (
        <div key={i} className="line">
          重映射：{fromTitle(r.fromQuestionId)} → {toTitle(r.toQuestionId)}（
          {valueLabel(from.questions.find(q => q.id === r.fromQuestionId), r.fromValue)} →{' '}
          {valueLabel(toQ(r.toQuestionId), r.toValue)}）
        </div>
      ))}
      {p.conflicts.map((c, i) => (
        <div key={i} className="line conflict-text">
          冲突：{fromTitle(c.questionId)} — {c.reason}
        </div>
      ))}
      {p.dropped.map((d, i) => (
        <div key={i} className="line muted">
          归档：{fromTitle(d.questionId)}（{d.reason}）
        </div>
      ))}
      {p.missing.length > 0 && <div className="line muted">待补：{p.missing.map(toTitle).join('、')}</div>}
    </details>
  )
}
