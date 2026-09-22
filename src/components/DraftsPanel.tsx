import { useState } from 'react'
import { ASSET_KIND_LABELS } from '../domain/constants'
import { answerValues, isEmptyValue, missingRequired, visibleQuestions } from '../domain/forms'
import { stableHash } from '../domain/hash'
import type { Answer, AssetKind, Draft, Question } from '../domain/types'
import { newId } from '../domain/util'
import { useAppStore } from '../state/store'
import { platformLabel, regionLabel, SOURCE_LABELS, Tag, TYPE_LABELS, valueLabel } from './ui'

export function DraftsPanel() {
  const { state } = useAppStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const draft = state.drafts.find(d => d.id === selectedId) ?? state.drafts[0]

  return (
    <div className="panel-grid">
      <section className="card">
        <h3>草稿（{state.drafts.length}）</h3>
        {state.drafts.map(d => {
          const version = state.formVersions.find(v => v.id === d.formVersionId)
          const missing = version
            ? missingRequired(version, { platform: d.platform, region: d.region, answers: answerValues(d.answers) })
            : []
          return (
            <div
              key={d.id}
              className={d.id === draft?.id ? 'version-card selected' : 'version-card'}
              onClick={() => setSelectedId(d.id)}
            >
              <div className="version-head">
                <strong>
                  {d.appName} · {platformLabel(d.platform)}/{regionLabel(d.region)}
                </strong>
                {missing.length > 0 ? <Tag tone="amber">缺 {missing.length} 项</Tag> : <Tag tone="green">完整</Tag>}
              </div>
              <div className="muted">
                {version?.label ?? d.formVersionId}
                {d.lastMigration && d.lastMigration.conflicts.length > 0 && (
                  <> · <span className="conflict-text">迁移冲突 {d.lastMigration.conflicts.length}</span></>
                )}
              </div>
            </div>
          )
        })}
      </section>
      <section className="card grow">{draft && <DraftDetail draft={draft} />}</section>
    </div>
  )
}

function DraftDetail({ draft }: { draft: Draft }) {
  const { state, dispatch } = useAppStore()
  const version = state.formVersions.find(v => v.id === draft.formVersionId)
  const [assetKind, setAssetKind] = useState<AssetKind>('screenshot')
  const [assetLabel, setAssetLabel] = useState('')

  if (!version) return <p className="hint">草稿引用的表单版本不存在。</p>

  const ctx = { platform: draft.platform, region: draft.region, answers: answerValues(draft.answers) }
  const visible = visibleQuestions(version, ctx)
  const hidden = version.questions.filter(q => !visible.includes(q))
  const missing = missingRequired(version, ctx)
  const missingIds = new Set(missing.map(q => q.id))
  const report = draft.lastMigration
  const reportVersion = report ? state.formVersions.find(v => v.id === report.toVersionId) : undefined
  const titleOf = (qid: string) => reportVersion?.questions.find(q => q.id === qid)?.title ?? qid

  return (
    <div>
      <h3>
        {draft.appName} · {platformLabel(draft.platform)}/{regionLabel(draft.region)}
      </h3>
      <p className="muted">
        表单版本：{version.label} · 可见必填 {visible.filter(q => q.required).length - missing.length}/
        {visible.filter(q => q.required).length} 已答
      </p>

      {visible.map(q => (
        <AnswerRow
          key={q.id}
          q={q}
          answer={draft.answers[q.id]}
          missing={missingIds.has(q.id)}
          onSet={value => dispatch({ type: 'answer/set', draftId: draft.id, questionId: q.id, value })}
          onClear={() => dispatch({ type: 'answer/clear', draftId: draft.id, questionId: q.id })}
        />
      ))}

      {hidden.length > 0 && (
        <details className="hidden-questions">
          <summary>条件未满足的题目（{hidden.length}）</summary>
          <ul>
            {hidden.map(q => (
              <li key={q.id}>
                {q.title}
                {draft.answers[q.id] && <span className="muted">（已存答案：{valueLabel(q, draft.answers[q.id].value)}）</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <h4>素材引用</h4>
      {draft.assets.map(a => (
        <div key={a.id} className="asset-row">
          <Tag tone="blue">{ASSET_KIND_LABELS[a.kind]}</Tag>
          <span>{a.label}</span>
          <code>{a.checksum}</code>
          <button
            className="btn btn-small"
            onClick={() => dispatch({ type: 'asset/remove', draftId: draft.id, assetId: a.id })}
          >
            移除
          </button>
        </div>
      ))}
      <div className="form-row">
        <select value={assetKind} onChange={e => setAssetKind(e.target.value as AssetKind)}>
          {Object.entries(ASSET_KIND_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <input value={assetLabel} placeholder="素材说明" onChange={e => setAssetLabel(e.target.value)} />
        <button
          className="btn"
          disabled={!assetLabel.trim()}
          onClick={() => {
            dispatch({
              type: 'asset/add',
              draftId: draft.id,
              asset: {
                id: newId('a'),
                kind: assetKind,
                label: assetLabel.trim(),
                checksum: stableHash(`${draft.id}:${assetLabel}:${Date.now()}`),
              },
            })
            setAssetLabel('')
          }}
        >
          添加素材
        </button>
      </div>

      {report && (
        <div className="migration-report">
          <h4>最近迁移记录</h4>
          <p className="muted">
            沿用 {report.carried.length} · 重映射 {report.remapped.length} · 冲突 {report.conflicts.length} · 归档{' '}
            {report.dropped.length} · 待补 {report.missing.length}
          </p>
          {report.conflicts.map((c, i) => (
            <div key={i} className="conflict-text">
              冲突：{titleOf(c.questionId)} — {c.reason}
            </div>
          ))}
          {report.missing.length > 0 && (
            <div className="muted">待补：{report.missing.map(titleOf).join('、')}</div>
          )}
          <div className="muted">旧答案已归档 {Object.keys(report.archived).length} 条，可随时查阅。</div>
        </div>
      )}
    </div>
  )
}

function AnswerRow({
  q,
  answer,
  missing,
  onSet,
  onClear,
}: {
  q: Question
  answer: Answer | undefined
  missing: boolean
  onSet: (value: Answer['value']) => void
  onClear: () => void
}) {
  return (
    <div className={missing ? 'answer-row missing' : 'answer-row'}>
      <div className="answer-head">
        <strong>{q.title}</strong>
        <span className="muted">{TYPE_LABELS[q.type]}</span>
        {q.required && <Tag tone="amber">必填</Tag>}
        {missing && <Tag tone="red">未答</Tag>}
        {answer && <Tag tone="grey">{SOURCE_LABELS[answer.source] ?? answer.source}</Tag>}
      </div>
      <AnswerInput q={q} answer={answer} onSet={onSet} onClear={onClear} />
    </div>
  )
}

function AnswerInput({
  q,
  answer,
  onSet,
  onClear,
}: {
  q: Question
  answer: Answer | undefined
  onSet: (value: Answer['value']) => void
  onClear: () => void
}) {
  const key = `${q.id}:${answer?.updatedAt ?? 0}`
  if (q.type === 'boolean') {
    const v = answer?.value
    return (
      <select
        key={key}
        value={v === true ? 'true' : v === false ? 'false' : ''}
        onChange={e => (e.target.value === '' ? onClear() : onSet(e.target.value === 'true'))}
      >
        <option value="">（未答）</option>
        <option value="true">是</option>
        <option value="false">否</option>
      </select>
    )
  }
  if (q.type === 'single') {
    const v = typeof answer?.value === 'string' ? answer.value : ''
    return (
      <select key={key} value={v} onChange={e => (e.target.value === '' ? onClear() : onSet(e.target.value))}>
        <option value="">（未答）</option>
        {q.options.map(o => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  if (q.type === 'multi') {
    const selected = Array.isArray(answer?.value) ? answer.value : []
    return (
      <div className="chip-row">
        {q.options.map(o => {
          const checked = selected.includes(o.id)
          return (
            <label key={o.id} className="inline">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const next = checked ? selected.filter(x => x !== o.id) : [...selected, o.id]
                  if (next.length === 0) onClear()
                  else onSet(next)
                }}
              />
              {o.label}
            </label>
          )
        })}
      </div>
    )
  }
  return (
    <input
      key={key}
      defaultValue={typeof answer?.value === 'string' ? answer.value : ''}
      placeholder="（未答）"
      onBlur={e => {
        const v = e.target.value.trim()
        const cur = typeof answer?.value === 'string' ? answer.value : ''
        if (v === cur) return
        if (v === '') onClear()
        else onSet(v)
      }}
    />
  )
}
