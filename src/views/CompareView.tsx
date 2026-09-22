import { useMemo, useState } from 'react';
import { useAppState } from '../state/store';
import { Badge, KindTag, platformLabel } from '../components/ui';
import { diffVersions, impactedDrafts } from '../domain/diff';

export function CompareView() {
  const state = useAppState();
  const [fromId, setFromId] = useState(state.versions[0]?.id ?? '');
  const [toId, setToId] = useState(state.versions[state.versions.length - 1]?.id ?? '');
  const from = state.versions.find((v) => v.id === fromId);
  const to = state.versions.find((v) => v.id === toId);

  const diff = useMemo(
    () => (from && to && from.id !== to.id ? diffVersions(from, to) : undefined),
    [from, to],
  );
  const impacts = useMemo(
    () => (diff ? impactedDrafts(diff, state.drafts) : []),
    [diff, state.drafts],
  );

  return (
    <div className="grid">
      <div className="card">
        <h2>对比两个表单版本</h2>
        <div className="inline-form">
          旧版
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {state.versions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          → 新版
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            {state.versions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          {from?.id === to?.id && <span className="muted small">请选择两个不同版本</span>}
        </div>
      </div>

      {diff && (
        <>
          <div className="card">
            <h2>题目变化（{diff.changes.filter((c) => c.kind !== 'unchanged').length} 项）</h2>
            {diff.changes.map((c, idx) => {
              if (c.kind === 'unchanged') return null;
              const title = c.previous?.title ?? c.question?.title ?? c.splitInto?.[0]?.title;
              return (
                <div key={idx} className="q-card">
                  <div className="q-title">
                    <KindTag kind={c.kind} /> {title}
                  </div>
                  {c.kind === 'split' && (
                    <div>
                      <div className="small muted" style={{ marginBottom: 4 }}>
                        旧题 {c.previous!.key} 被拆为 {c.splitInto!.length} 道条件题：
                      </div>
                      {c.splitInto!.map((q) => (
                        <div key={q.key} className="small" style={{ paddingLeft: 12 }}>
                          • {q.title}
                          <Badge tone="gray">{q.key}</Badge>
                          <Badge tone="amber">
                            {q.scope.regions.includes('*') ? '全地区' : q.scope.regions.join('/')}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                  {c.kind === 'options-changed' && (
                    <div className="small">
                      {c.options?.added.map((id) => (
                        <Badge key={id} tone="green">新增选项 {id}</Badge>
                      ))}
                      {c.options?.removed.map((id) => (
                        <Badge key={id} tone="red">删除选项 {id}</Badge>
                      ))}
                    </div>
                  )}
                  {c.kind === 'condition-changed' && (
                    <div className="small muted">
                      条件：{c.previous!.conditions.map((x) => `${x.questionId}=${x.optionId}`).join(' & ') || '（无条件）'}
                      {' → '}
                      {c.question!.conditions.map((x) => `${x.questionId}=${x.optionId}`).join(' & ') || '（无条件）'}
                    </div>
                  )}
                  {c.kind === 'scope-changed' && (
                    <div className="small muted">
                      范围：{c.previous!.scope.platforms.join('/')} {c.previous!.scope.regions.join('/')}
                      {' → '}
                      {c.question!.scope.platforms.join('/')} {c.question!.scope.regions.join('/')}
                    </div>
                  )}
                  {(c.kind === 'added' || c.kind === 'removed' || c.kind === 'modified') && (
                    <div className="small muted">{c.previous?.key ?? c.question?.key}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="card">
            <h2>受影响的草稿（{impacts.length} 份）</h2>
            <p className="muted small">
              结合每份草稿的平台/地区、现有答案与条件分支判断；未作答或范围不适用的草稿不会被误报。
            </p>
            {impacts.length === 0 && <div className="ok-box">没有草稿受此版本变化影响。</div>}
            {impacts.map((impact) => {
              const d = state.drafts.find((x) => x.id === impact.draftId)!;
              return (
                <div key={impact.draftId} className="q-card">
                  <div className="q-title">
                    {d.appName} <Badge tone="gray">{platformLabel(d.platform)} · {d.region}</Badge>
                  </div>
                  {impact.items.map((it, i) => (
                    <div key={i} className="small">
                      <KindTag kind={it.kind} /> <code>{it.key}</code> — {it.reason}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
