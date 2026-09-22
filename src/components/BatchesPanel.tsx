import { useState } from 'react'
import {
  CHECK_KINDS,
  CHECK_LABELS,
  checkStates,
  currentFingerprint,
  isReleasable,
} from '../domain/batch'
import { stableHash } from '../domain/hash'
import type { Batch, CheckKind, IngestOutcome, ReviewResult } from '../domain/types'
import { newId } from '../domain/util'
import { useAppStore } from '../state/store'
import { formatTime, platformLabel, regionLabel, shortHash, Tag } from './ui'

const OUTCOME_LABELS: Record<IngestOutcome, string> = {
  applied: '已采纳',
  late: '迟到，已忽略',
  duplicate: '重复，已忽略',
  'unknown-batch': '未知批次',
}

export function BatchesPanel() {
  const { state, dispatch } = useAppStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const current = state.formVersions.find(v => v.id === state.currentFormVersionId)
  const eligible = current ? state.drafts.filter(d => d.formVersionId === current.id) : []
  const batch = state.batches.find(b => b.id === selectedId) ?? state.batches[state.batches.length - 1]

  return (
    <div className="panel-grid">
      <section className="card">
        <h3>冻结新批次</h3>
        <p className="hint">
          把当前版本（{current?.label ?? '—'}）下的一组平台/地区资料冻结为提交批次，并立即运行完整性、内容复核、素材检查。
        </p>
        {eligible.length === 0 && (
          <p className="hint">当前版本下没有可冻结的草稿。请先在「迁移」页把草稿迁到当前版本。</p>
        )}
        {eligible.map(d => (
          <label key={d.id} className="inline block">
            <input
              type="checkbox"
              checked={picked.has(d.id)}
              onChange={() =>
                setPicked(s => {
                  const next = new Set(s)
                  if (next.has(d.id)) next.delete(d.id)
                  else next.add(d.id)
                  return next
                })
              }
            />
            {d.appName} · {platformLabel(d.platform)}/{regionLabel(d.region)}
          </label>
        ))}
        <div className="form-row">
          <input
            value={label}
            placeholder={`批次 ${state.batches.length + 1}`}
            onChange={e => setLabel(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={picked.size === 0}
            onClick={() => {
              dispatch({
                type: 'batch/freeze',
                label: label.trim() || `批次 ${state.batches.length + 1}`,
                draftIds: [...picked],
              })
              setPicked(new Set())
              setLabel('')
            }}
          >
            冻结批次
          </button>
        </div>

        <h3>批次列表（{state.batches.length}）</h3>
        {state.batches.map(b => (
          <BatchCard key={b.id} batch={b} selected={b.id === batch?.id} onSelect={() => setSelectedId(b.id)} />
        ))}
      </section>

      <section className="card grow">{batch && <BatchDetail batch={batch} />}</section>
    </div>
  )
}

function BatchCard({ batch, selected, onSelect }: { batch: Batch; selected: boolean; onSelect: () => void }) {
  const { state } = useAppStore()
  const version = state.formVersions.find(v => v.id === batch.formVersionId)
  const states = version ? checkStates(batch, state.drafts, version) : []
  const staleCount = states.filter(s => s.stale).length
  const releasable = version ? isReleasable(batch, state.drafts, version) : false

  return (
    <div className={selected ? 'version-card selected' : 'version-card'} onClick={onSelect}>
      <div className="version-head">
        <strong>{batch.label}</strong>
        {releasable ? (
          <Tag tone="green">可发布</Tag>
        ) : staleCount > 0 ? (
          <Tag tone="amber">{staleCount} 项检查已过期</Tag>
        ) : (
          <Tag tone="grey">未就绪</Tag>
        )}
      </div>
      <div className="muted">
        {batch.items.length} 个平台/地区 · {version?.label ?? batch.formVersionId} · {formatTime(batch.createdAt)}
      </div>
    </div>
  )
}

function BatchDetail({ batch }: { batch: Batch }) {
  const { state, dispatch } = useAppStore()
  const version = state.formVersions.find(v => v.id === batch.formVersionId)
  if (!version) return <p className="hint">批次引用的表单版本不存在。</p>
  const states = checkStates(batch, state.drafts, version)

  return (
    <div>
      <h3>{batch.label}</h3>
      <p className="muted">
        冻结于 {formatTime(batch.createdAt)} · 表单版本 {version.label} · 冻结指纹 {shortHash(batch.snapshotFingerprint)}
      </p>

      <h4>包含资料</h4>
      <table className="table">
        <thead>
          <tr>
            <th>应用</th>
            <th>平台/地区</th>
            <th>冻结后状态</th>
          </tr>
        </thead>
        <tbody>
          {batch.items.map(i => {
            const live = state.drafts.find(d => d.id === i.draftId)
            const snap = batch.snapshot[i.draftId]
            const changed =
              !live ||
              !snap ||
              stableHash({ a: live.answers, s: live.assets, v: live.formVersionId }) !==
                stableHash({ a: snap.answers, s: snap.assets, v: snap.formVersionId })
            return (
              <tr key={i.draftId}>
                <td>{live?.appName ?? snap?.appName ?? i.draftId}</td>
                <td>
                  {platformLabel(i.platform)}/{regionLabel(i.region)}
                </td>
                <td>{changed ? <Tag tone="amber">已变更</Tag> : <Tag tone="green">与冻结时一致</Tag>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h4>检查记录</h4>
      <table className="table">
        <thead>
          <tr>
            <th>检查</th>
            <th>结果</th>
            <th>状态</th>
            <th>证据哈希</th>
            <th>时间</th>
            <th>明细</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {CHECK_KINDS.map(kind => {
            const rec = states.find(s => s.kind === kind)
            if (!rec) return null
            return (
              <tr key={kind}>
                <td>{CHECK_LABELS[kind]}</td>
                <td>{rec.status === 'passed' ? <Tag tone="green">通过</Tag> : <Tag tone="red">未通过</Tag>}</td>
                <td>{rec.stale ? <Tag tone="amber">已过期</Tag> : <Tag tone="green">有效</Tag>}</td>
                <td>
                  <code>{shortHash(rec.evidenceHash)}</code>
                </td>
                <td>{formatTime(rec.ranAt)}</td>
                <td className="detail-cell">{rec.detail}</td>
                <td>
                  <button
                    className="btn btn-small"
                    onClick={() => dispatch({ type: 'check/rerun', batchId: batch.id, kind })}
                  >
                    重新检查
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="hint">表单或答案变化只会让相关检查过期，冻结时的证据始终保留；重新检查即可刷新。</p>

      <details className="snapshot">
        <summary>冻结证据（快照）</summary>
        {batch.items.map(i => (
          <div key={i.draftId}>
            <h5>
              {batch.snapshot[i.draftId]?.appName} · {platformLabel(i.platform)}/{regionLabel(i.region)}
            </h5>
            <pre>{JSON.stringify(batch.snapshot[i.draftId]?.answers ?? {}, null, 2)}</pre>
          </div>
        ))}
      </details>

      <ReviewSimulator batch={batch} />
    </div>
  )
}

function ReviewSimulator({ batch }: { batch: Batch }) {
  const { state, dispatch } = useAppStore()
  const [kind, setKind] = useState<CheckKind>('content-review')
  const [verdict, setVerdict] = useState<'approved' | 'rejected'>('approved')
  const [mode, setMode] = useState<'fresh' | 'late' | 'duplicate'>('fresh')
  const log = state.reviewLog.filter(l => l.result.batchId === batch.id)

  const send = () => {
    const fingerprint = mode === 'late' ? batch.snapshotFingerprint : currentFingerprint(batch, state.drafts)
    const result: ReviewResult = {
      id: newId('rv'),
      batchId: batch.id,
      kind,
      verdict,
      fingerprint,
      receivedAt: Date.now(),
      note: `模拟${mode === 'fresh' ? '实时' : mode === 'late' ? '迟到' : '重复'}结果`,
    }
    dispatch({ type: 'review/ingest', result })
    if (mode === 'duplicate') dispatch({ type: 'review/ingest', result })
  }

  return (
    <div className="review-sim">
      <h4>模拟审核结果送达</h4>
      <div className="form-row">
        <select value={kind} onChange={e => setKind(e.target.value as CheckKind)}>
          {CHECK_KINDS.map(k => (
            <option key={k} value={k}>
              {CHECK_LABELS[k]}
            </option>
          ))}
        </select>
        <select value={verdict} onChange={e => setVerdict(e.target.value as 'approved' | 'rejected')}>
          <option value="approved">通过</option>
          <option value="rejected">驳回</option>
        </select>
        <select value={mode} onChange={e => setMode(e.target.value as 'fresh' | 'late' | 'duplicate')}>
          <option value="fresh">实时（按当前内容）</option>
          <option value="late">迟到（按冻结时内容）</option>
          <option value="duplicate">重复（同一结果送两次）</option>
        </select>
        <button className="btn" onClick={send}>
          送达
        </button>
      </div>
      <p className="hint">
        「迟到」使用冻结时的指纹：先改动任意草稿答案再送达，可看到结果被忽略、不会放行批次；重复送达同理。
      </p>
      {log.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>结果</th>
              <th>检查</th>
              <th>结论</th>
              <th>处理</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {log.map((l, i) => (
              <tr key={i}>
                <td>
                  <code>{l.result.id}</code>
                  {l.result.note && <span className="muted">（{l.result.note}）</span>}
                </td>
                <td>{CHECK_LABELS[l.result.kind]}</td>
                <td>{l.result.verdict === 'approved' ? '通过' : '驳回'}</td>
                <td>
                  {l.outcome === 'applied' ? <Tag tone="green">{OUTCOME_LABELS[l.outcome]}</Tag> : <Tag tone="amber">{OUTCOME_LABELS[l.outcome]}</Tag>}
                </td>
                <td>{formatTime(l.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
