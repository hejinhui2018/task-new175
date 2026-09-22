import { useMemo } from 'react';
import { useAppState, useStore } from '../state/store';
import { Badge, platformLabel } from '../components/ui';
import { isQuestionVisible, scopeApplies, findAnswer } from '../domain/conditions';
import type { AnswerSource, Draft, FormVersion, Question } from '../domain/types';

const STATUS_TONE: Record<Draft['status'], 'gray' | 'blue' | 'green' | 'red'> = {
  draft: 'gray',
  in_review: 'blue',
  approved: 'green',
  rejected: 'red',
};
const STATUS_LABEL: Record<Draft['status'], string> = {
  draft: '草稿',
  in_review: '审核中',
  approved: '已通过',
  rejected: '已驳回',
};

export function DraftsView({
  selectedDraftId,
  onSelect,
}: {
  selectedDraftId?: string;
  onSelect: (id: string) => void;
}) {
  const state = useAppState();
  const store = useStore();
  const draft = state.drafts.find((d) => d.id === selectedDraftId) ?? state.drafts[0];
  const version = state.versions.find((v) => v.id === draft?.formVersionId);

  const staleKeys = useMemo(() => {
    if (!draft || !version) return [];
    const liveKeys = new Set(version.questions.map((q) => q.key));
    return draft.answers.filter((a) => !liveKeys.has(a.questionKey)).map((a) => a.questionKey);
  }, [draft, version]);

  if (!draft || !version) return <div className="card">暂无草稿</div>;

  return (
    <div className="grid two">
      <div className="card">
        <h2>草稿资料（{state.drafts.length}）</h2>
        {state.drafts.map((d) => (
          <div
            key={d.id}
            className={`list-item ${d.id === draft.id ? 'selected' : ''}`}
            onClick={() => onSelect(d.id)}
          >
            <div>
              <strong>{d.appName}</strong> <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
            </div>
            <div className="sub">
              {platformLabel(d.platform)} · {d.region}
            </div>
            <div className="sub">
              依据版本：{state.versions.find((v) => v.id === d.formVersionId)?.name ?? d.formVersionId}
              {d.previousSnapshot && <Badge tone="blue">可回退</Badge>}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>
            {platformLabel(draft.platform)} · {draft.region} 资料
          </h2>
          <div className="row">
            <select
              value={draft.status}
              onChange={(e) => store.setDraftStatus(draft.id, e.target.value as Draft['status'])}
            >
              {Object.entries(STATUS_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            <button
              className="tiny"
              disabled={!draft.previousSnapshot}
              onClick={() => store.rollbackDraft(draft.id)}
              title="恢复迁移前的表单版本与答案"
            >
              ↩ 版本回退
            </button>
          </div>
        </div>

        {staleKeys.length > 0 && (
          <div className="warn-box">
            存在 {staleKeys.length} 个当前版本题目已不存在、但尚未迁移的旧答案：
            {staleKeys.join('、')}（保持原样，不会自动丢弃）
          </div>
        )}

        <QuestionForm draft={draft} version={version} />
        <AssetsPanel draft={draft} />
      </div>
    </div>
  );
}

function QuestionForm({ draft, version }: { draft: Draft; version: FormVersion }) {
  const store = useStore();
  const setAns = (patch: { optionIds?: string[]; text?: string; source?: AnswerSource }, q: Question) => {
    store.setAnswer(draft.id, q.key, patch);
  };

  return (
    <div style={{ marginTop: 10 }}>
      {version.questions.map((q) => {
        const answer = findAnswer(draft, q.key);
        const inScope = scopeApplies(q.scope, draft.platform, draft.region);
        const visible = inScope && isQuestionVisible(q, draft, version.questions);
        return (
          <div key={q.key} className={`q-card ${visible ? '' : 'hidden-q'}`}>
            <div className="q-title">
              {q.title}
              {answer && <SourceBadge source={answer.source} />}
            </div>
            <div className="q-meta">
              {q.key} · {q.type === 'single' ? '单选' : q.type === 'multi' ? '多选' : '文本'}
              {!inScope && <Badge tone="gray">范围外（{draft.platform}/{draft.region} 不适用）</Badge>}
              {inScope && !visible && <Badge tone="amber">条件未满足，暂不展示</Badge>}
            </div>

            {visible && (
              <>
                {q.type === 'text' ? (
                  <textarea
                    aria-label={q.title}
                    value={answer?.text ?? ''}
                    onChange={(e) => setAns({ text: e.target.value }, q)}
                  />
                ) : (
                  q.options.map((o) => {
                    const checked = answer?.optionIds.includes(o.id) ?? false;
                    return (
                      <label className="opt-row" key={o.id}>
                        <input
                          type={q.type === 'single' ? 'radio' : 'checkbox'}
                          name={`${draft.id}:${q.key}`}
                          checked={checked}
                          onChange={() => {
                            if (q.type === 'single') {
                              setAns({ optionIds: [o.id] }, q);
                            } else {
                              const cur = answer?.optionIds ?? [];
                              setAns(
                                { optionIds: checked ? cur.filter((x) => x !== o.id) : [...cur, o.id] },
                                q,
                              );
                            }
                          }}
                        />
                        {o.label} <span className="muted small">({o.id})</span>
                      </label>
                    );
                  })
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SourceBadge({ source }: { source: AnswerSource }) {
  if (source.kind === 'manual') return <Badge tone="gray">手填</Badge>;
  if (source.kind === 'inherited') return <Badge tone="blue">沿用{source.ref ? ` ${source.ref}` : ''}</Badge>;
  return <Badge tone="amber">素材 {source.ref ?? ''}</Badge>;
}

function AssetsPanel({ draft }: { draft: Draft }) {
  const store = useStore();
  return (
    <>
      <h3>素材引用（{draft.assets.length}）</h3>
      <table>
        <thead>
          <tr><th>素材</th><th>类型</th><th>指纹</th><th></th></tr>
        </thead>
        <tbody>
          {draft.assets.map((a) => (
            <tr key={a.id}>
              <td>{a.name}</td>
              <td>{a.kind}</td>
              <td className="small muted">{a.fingerprint}</td>
              <td>
                <button
                  className="tiny"
                  onClick={() =>
                    store.replaceAsset(draft.id, a.id, {
                      fingerprint: a.fingerprint.replace(/~v\w+$/, '') + `~v${Date.now().toString(36)}`,
                    })
                  }
                  title="模拟素材重新上传：仅素材检查会过期，旧批次保留当时指纹证据"
                >
                  替换素材
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
