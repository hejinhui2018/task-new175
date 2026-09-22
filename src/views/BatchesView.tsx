import { useState } from 'react';
import { useAppState, useStore } from '../state/store';
import { Badge, CHECK_LABEL, fmtTime, platformLabel } from '../components/ui';
import type { CheckType, SubmissionBatch } from '../domain/types';

const STATUS_LABEL: Record<SubmissionBatch['status'], { label: string; tone: 'gray' | 'blue' | 'green' | 'red' }> = {
  frozen: { label: '冻结待审', tone: 'gray' },
  releasable: { label: '可发布', tone: 'green' },
  released: { label: '已发布', tone: 'blue' },
  expired: { label: '部分过期', tone: 'red' },
};

export function BatchesView() {
  const state = useAppState();
  const store = useStore();
  const batches = store.batchesWithFreshness();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [label, setLabel] = useState('');

  const togglePick = (id: string) => {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicked(next);
  };

  return (
    <div className="grid">
      <div className="card">
        <h2>冻结提交批次</h2>
        <p className="muted small">
          勾选一组平台与地区资料冻结为提交批次，系统快照当时的表单版本、逐题答案证据与素材指纹；之后改资料不会动到旧批次证据，只让相关检查过期。
        </p>
        <div className="inline-form">
          批次名称
          <input
            placeholder="如 2026 九月批次"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            className="primary tiny"
            disabled={picked.size === 0 || !label.trim()}
            onClick={() => {
              store.freezeBatch(label.trim(), [...picked]);
              setLabel('');
              setPicked(new Set());
            }}
          >
            冻结所选 {picked.size > 0 ? `（${picked.size} 份）` : ''}
          </button>
        </div>
        {state.drafts.map((d) => (
          <label className="opt-row" key={d.id}>
            <input type="checkbox" checked={picked.has(d.id)} onChange={() => togglePick(d.id)} />
            {d.appName} · {platformLabel(d.platform)} · {d.region}
            <Badge tone="gray">{state.versions.find((v) => v.id === d.formVersionId)?.name}</Badge>
          </label>
        ))}
      </div>

      {batches.map((b) => <BatchCard key={b.id} batch={b} />)}

      <div className="card">
        <h2>审核结果到达日志</h2>
        <p className="muted small">
          迟到（批次已发布或证据已过期）与重复结果一律拒收，不会放行任何新批次；只有命中冻结批次且证据一致的新结果才计入。
        </p>
        {state.reviewLog.length === 0 && <div className="muted small">暂无审核结果。</div>}
        <table>
          <thead>
            <tr><th>收到时间</th><th>批次</th><th>草稿</th><th>检查</th><th>结论</th><th>处理</th><th>原因</th></tr>
          </thead>
          <tbody>
            {state.reviewLog.map((e) => (
              <tr key={e.id}>
                <td className="small">{fmtTime(e.receivedAt)}</td>
                <td className="small">{e.batchId.slice(0, 14)}…</td>
                <td className="small">{e.draftId}</td>
                <td className="small">{CHECK_LABEL[e.type]}</td>
                <td className="small">{e.result === 'pass' ? '通过' : '不通过'}</td>
                <td className={e.accepted ? 'log-accepted small' : 'log-rejected small'}>
                  {e.accepted ? '✓ 计入' : '✗ 拒收'}
                </td>
                <td className="small muted">{e.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BatchCard({ batch }: { batch: SubmissionBatch }) {
  const store = useStore();
  const [reviewer, setReviewer] = useState('审核员 A');
  const status = STATUS_LABEL[batch.status];

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>
          {batch.label}
          <Badge tone={status.tone}>{status.label}</Badge>
        </h2>
        <div className="muted small">
          冻结于 {fmtTime(batch.createdAt)} · {batch.items.length} 份
          {batch.decidedAt && ` · 决策于 ${fmtTime(batch.decidedAt)}`}
        </div>
      </div>

      <table>
        <thead>
          <tr><th>草稿</th><th>冻结版本</th><th>完整性</th><th>内容复核</th><th>素材检查</th><th>登记结果</th></tr>
        </thead>
        <tbody>
          {batch.items.map((item) => {
            const checks = batch.checks[item.draftId] ?? [];
            const byType = (t: CheckType) => checks.find((c) => c.type === t && !c.stale);
            const anyStale = checks.some((c) => c.stale);
            return (
              <tr key={item.draftId}>
                <td>
                  {item.draftId}
                  <div className="small muted">{platformLabel(item.platform)} · {item.region}</div>
                  {anyStale && <Badge tone="red">部分检查已过期，旧证据保留</Badge>}
                </td>
                <td className="small">{item.formVersionId}</td>
                {(['completeness', 'content-review', 'asset-check'] as CheckType[]).map((t) => {
                  const c = byType(t);
                  const staleOne = checks.find((x) => x.type === t && x.stale);
                  return (
                    <td key={t}>
                      {c ? (
                        <span className={`check-pill ${c.result}`}>{c.result === 'pass' ? '✓ 通过' : '✗ 不通过'}</span>
                      ) : staleOne ? (
                        <span className="check-pill stale fail">旧结果已过期</span>
                      ) : (
                        <span className="check-pill pending">待检查</span>
                      )}
                    </td>
                  );
                })}
                <td>
                  {batch.status === 'released' ? (
                    <span className="muted small">已发布，后续结果按迟到处理</span>
                  ) : (
                    <ReviewInput
                      reviewer={reviewer}
                      onReviewer={setReviewer}
                      onSubmit={(type, result) =>
                        store.recordReview({ batchId: batch.id, draftId: item.draftId, type, result, reviewer, submittedAt: Date.now() })
                      }
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="row end" style={{ marginTop: 8 }}>
        <button
          className="primary"
          disabled={batch.status !== 'releasable'}
          onClick={() => store.releaseBatch(batch.id)}
          title={batch.status === 'releasable' ? '三类检查全部通过且证据未过期' : '需要所有草稿的三类检查通过且未过期'}
        >
          放行发布
        </button>
      </div>
    </div>
  );
}

function ReviewInput({
  reviewer,
  onReviewer,
  onSubmit,
}: {
  reviewer: string;
  onReviewer: (v: string) => void;
  onSubmit: (type: CheckType, result: 'pass' | 'fail') => void;
}) {
  const [type, setType] = useState<CheckType>('completeness');
  const [result, setResult] = useState<'pass' | 'fail'>('pass');
  return (
    <div className="inline-form" style={{ margin: 0 }}>
      <select value={type} onChange={(e) => setType(e.target.value as CheckType)} aria-label="检查类型">
        <option value="completeness">完整性</option>
        <option value="content-review">内容复核</option>
        <option value="asset-check">素材检查</option>
      </select>
      <select value={result} onChange={(e) => setResult(e.target.value as 'pass' | 'fail')} aria-label="审核结论">
        <option value="pass">通过</option>
        <option value="fail">不通过</option>
      </select>
      <input value={reviewer} onChange={(e) => onReviewer(e.target.value)} aria-label="审核人" style={{ width: 90 }} />
      <button className="tiny" onClick={() => onSubmit(type, result)}>提交结果</button>
    </div>
  );
}
