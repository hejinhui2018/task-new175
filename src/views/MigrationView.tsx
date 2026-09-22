import { useState } from 'react';
import { useAppState, useStore } from '../state/store';
import { Badge, CONFLICT_LABEL, platformLabel } from '../components/ui';
import {
  previewDraftMigration,
  resolvePreview,
  type MigrationResolutionEntry,
  type MigrationResolutions,
} from '../domain/migration';
import { scopeApplies } from '../domain/conditions';
import type {
  AnswerMigration,
  Draft,
  DraftMigrationPreview,
  FormVersion,
  MigrationPlan,
  Question,
} from '../domain/types';

const DEST_LABEL: Record<AnswerMigration['destination'], string> = {
  carry: '原样沿用',
  'map-option': '选项映射',
  split: '拆分到多题',
  text: '转文本题',
  drop: '丢弃（无去向）',
  blocked: '不适用，阻断',
};

export function MigrationView({
  onGoDraft,
  onSwitchTab,
}: {
  onGoDraft: (id: string) => void;
  onSwitchTab: () => void;
}) {
  const state = useAppState();
  const store = useStore();
  const plan = state.plans[0];
  const from = state.versions.find((v) => v.id === plan?.fromVersionId);
  const to = state.versions.find((v) => v.id === plan?.toVersionId);

  // 每份草稿：选中的旧题（部分迁移）+ 冲突人工解决方案
  const [included, setIncluded] = useState<Record<string, Set<string>>>({});
  const [resolutions, setResolutions] = useState<Record<string, MigrationResolutions>>({});

  if (!plan || !from || !to) {
    return <div className="card">缺少迁移计划或对应版本。</div>;
  }

  const oldDrafts = state.drafts.filter((d) => d.formVersionId === from.id);
  const newDrafts = state.drafts.filter((d) => d.formVersionId === to.id);

  const includedKeysOf = (d: Draft): Set<string> =>
    included[d.id] ?? new Set(plan.mappings.map((m) => m.fromKey));

  const previewOf = (d: Draft): DraftMigrationPreview => {
    const keys = included[d.id] ? [...includedKeysOf(d)] : undefined;
    const raw = previewDraftMigration(d, from, to, state.plans, keys ? { onlyKeys: keys } : {});
    return resolvePreview(d, to, raw, resolutions[d.id] ?? {});
  };

  const toggleInclude = (d: Draft, key: string) => {
    const cur = new Set(includedKeysOf(d));
    cur.has(key) ? cur.delete(key) : cur.add(key);
    setIncluded((s) => ({ ...s, [d.id]: cur }));
  };

  const setResolution = (d: Draft, fromKey: string, entry: MigrationResolutionEntry) => {
    setResolutions((s) => ({
      ...s,
      [d.id]: { ...(s[d.id] ?? {}), [fromKey]: entry },
    }));
  };

  const confirmOne = (d: Draft) => {
    const pv = previewOf(d);
    store.applyMigrations([{ draftId: d.id, preview: pv }]);
    setResolutions((s) => ({ ...s, [d.id]: {} }));
  };
  const confirmAll = () => {
    const items = oldDrafts
      .map((d) => ({ draftId: d.id, preview: previewOf(d) }))
      .filter((x) => !x.preview.blocked);
    if (items.length === 0) return;
    store.applyMigrations(items);
  };

  return (
    <div className="grid">
      <div className="card">
        <h2>迁移计划：{from.name} → {to.name}</h2>
        <p className="muted small">{plan.note}</p>
        <table>
          <thead>
            <tr><th>旧题</th><th>去向</th><th>目标题</th><th>说明</th></tr>
          </thead>
          <tbody>
            {plan.mappings.map((m) => (
              <tr key={m.fromKey}>
                <td><code>{m.fromKey}</code></td>
                <td><Badge tone="blue">{DEST_LABEL[m.destination]}</Badge></td>
                <td className="small">{m.toKeys?.join('、') ?? '—'}</td>
                <td className="small muted">{m.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>
            迁移预览与逐份确认（待迁移 {oldDrafts.length} 份）
          </h2>
          <button className="primary tiny" disabled={oldDrafts.length === 0} onClick={confirmAll}>
            批量确认无冲突草稿
          </button>
        </div>
        <p className="muted small">
          勾选旧题参与本次迁移（部分迁移），未勾选项保持原样；每份草稿需单独确认，未确认的草稿不会被改动。
        </p>

        {oldDrafts.map((d) => (
          <DraftMigrationCard
            key={d.id}
            draft={d}
            to={to}
            plan={plan}
            preview={previewOf(d)}
            includedKeys={includedKeysOf(d)}
            resolution={resolutions[d.id] ?? {}}
            onToggleInclude={(key) => toggleInclude(d, key)}
            onResolve={(fromKey, entry) => setResolution(d, fromKey, entry)}
            onConfirm={() => confirmOne(d)}
          />
        ))}
        {oldDrafts.length === 0 && <div className="ok-box">所有草稿都已在新版。</div>}
      </div>

      {newDrafts.length > 0 && (
        <div className="card">
          <h2>已迁移草稿（{newDrafts.length}）</h2>
          {newDrafts.map((d) => (
            <div key={d.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                {d.appName} <Badge tone="gray">{platformLabel(d.platform)} · {d.region}</Badge>
                {d.previousSnapshot && <Badge tone="blue">保留 {state.versions.find((v) => v.id === d.previousSnapshot!.formVersionId)?.name} 快照</Badge>}
              </span>
              <span className="row">
                <button className="tiny" disabled={!d.previousSnapshot} onClick={() => { onGoDraft(d.id); store.rollbackDraft(d.id); }}>
                  ↩ 回退到旧版
                </button>
                <button className="tiny" onClick={() => { onGoDraft(d.id); onSwitchTab(); }}>
                  查看资料
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DraftMigrationCard({
  draft,
  to,
  plan,
  preview,
  includedKeys,
  resolution,
  onToggleInclude,
  onResolve,
  onConfirm,
}: {
  draft: Draft;
  to: FormVersion;
  plan: MigrationPlan;
  preview: DraftMigrationPreview;
  includedKeys: Set<string>;
  resolution: MigrationResolutions;
  onToggleInclude: (fromKey: string) => void;
  onResolve: (fromKey: string, entry: MigrationResolutionEntry) => void;
  onConfirm: () => void;
}) {
  const newByKey = new Map(to.questions.map((q) => [q.key, q]));

  return (
    <div className="q-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="q-title">
          {platformLabel(draft.platform)} · {draft.region}
          {preview.blocked
            ? <Badge tone="red">存在硬冲突，未解决前不能迁移</Badge>
            : <Badge tone="green">可以确认迁移</Badge>}
        </div>
        <button className="primary tiny" disabled={preview.blocked} onClick={onConfirm}>
          确认并迁移这份
        </button>
      </div>

      {plan.mappings.map((mapping) => {
        const oldAnswer = draft.answers.find((a) => a.questionKey === mapping.fromKey);
        const includedFlag = includedKeys.has(mapping.fromKey);
        const m = preview.migrations.find((x) => x.fromKey === mapping.fromKey);
        const entry = resolution[mapping.fromKey] ?? { skipKeys: [], answers: [] };
        const skipKeys = new Set(entry.skipKeys ?? []);
        const answerOverrides = new Map((entry.answers ?? []).map((a) => [a.questionKey, a]));

        return (
          <div key={mapping.fromKey} style={{ borderTop: '1px dashed var(--border)', marginTop: 8, paddingTop: 8 }}>
            <label className="opt-row">
              <input
                type="checkbox"
                checked={includedFlag}
                disabled={!oldAnswer}
                onChange={() => onToggleInclude(mapping.fromKey)}
              />
              <code>{mapping.fromKey}</code>
              <Badge tone="blue">{DEST_LABEL[mapping.destination]}</Badge>
              {!oldAnswer && <span className="muted small">（旧草稿未作答，跳过）</span>}
              {oldAnswer && (
                <span className="muted small">
                  旧答案：{oldAnswer.optionIds.join('/') || oldAnswer.text || '—'}
                </span>
              )}
            </label>

            {includedFlag && oldAnswer && m && (
              <>
                {m.conflicts.map((c) => (
                  <div key={c} className={CONFLICT_LABEL[c].hard ? 'conflict-box' : 'warn-box'}>
                    {CONFLICT_LABEL[c].hard ? '⛔ ' : '⚠ '}{CONFLICT_LABEL[c].label}
                  </div>
                ))}
                {m.preview.length === 0 && mapping.destination === 'drop' && (
                  <div className="muted small">该答案将被丢弃。</div>
                )}
                {m.preview.map((pv) => {
                  const q = newByKey.get(pv.questionKey);
                  const skipped = skipKeys.has(pv.questionKey);
                  const inScope = q ? scopeApplies(q.scope, draft.platform, draft.region) : true;
                  const override = answerOverrides.get(pv.questionKey);
                  const curOptionIds = override?.optionIds ?? pv.optionIds;
                  const curText = override?.text ?? pv.text;
                  return (
                    <div key={pv.questionKey} style={{ paddingLeft: 16, margin: '4px 0' }}>
                      <div className="small">
                        → <strong>{q?.title ?? pv.questionKey}</strong>
                        <code> {pv.questionKey}</code>
                        {!inScope && <Badge tone="gray">范围外，建议跳过</Badge>}
                        <label className="opt-row" style={{ display: 'inline-flex', marginLeft: 8 }}>
                          <input
                            type="checkbox"
                            checked={skipped}
                            onChange={(e) =>
                              onResolve(m.fromKey, {
                                ...entry,
                                skipKeys: e.target.checked
                                  ? [...skipKeys, pv.questionKey]
                                  : [...skipKeys].filter((k) => k !== pv.questionKey),
                              })
                            }
                          />
                          跳过该目标题
                        </label>
                      </div>
                      {!skipped && q && (
                        <ResolutionControl
                          q={q}
                          optionIds={curOptionIds}
                          text={curText}
                          onChange={(patch) =>
                            onResolve(m.fromKey, {
                              ...entry,
                              answers: upsertAnswer(entry.answers ?? [], {
                                questionKey: q.key,
                                ...patch,
                              }),
                            })
                          }
                        />
                      )}
                    </div>
                  );
                })}
                {mapping.note && <div className="muted small" style={{ paddingLeft: 16 }}>{mapping.note}</div>}
              </>
            )}
          </div>
        );
      })}

      {preview.untouched.length > 0 && (
        <div className="muted small">未迁移、保持原样的旧答案：{preview.untouched.join('、')}</div>
      )}
      {preview.missing.length > 0 && (
        <div className="warn-box">
          迁移后仍需补答（新版可见但缺失）：{preview.missing.join('、')}
        </div>
      )}
    </div>
  );
}

function upsertAnswer(
  list: NonNullable<MigrationResolutionEntry['answers']>,
  next: { questionKey: string; optionIds?: string[]; text?: string },
): NonNullable<MigrationResolutionEntry['answers']> {
  const rest = list.filter((a) => a.questionKey !== next.questionKey);
  return [...rest, next];
}

function ResolutionControl({
  q,
  optionIds,
  text,
  onChange,
}: {
  q: Question;
  optionIds: string[];
  text?: string;
  onChange: (patch: { optionIds?: string[]; text?: string }) => void;
}) {
  return (
    <div style={{ paddingLeft: 16 }}>
      {q.type === 'text' ? (
        <textarea
          aria-label={`人工确认 ${q.title}`}
          value={text ?? ''}
          placeholder="确认/修订文本内容"
          onChange={(e) => onChange({ text: e.target.value })}
        />
      ) : (
        q.options.map((o) => {
          const checked = optionIds.includes(o.id);
          return (
            <label className="opt-row" key={o.id}>
              <input
                type={q.type === 'single' ? 'radio' : 'checkbox'}
                name={`resolve:${q.key}`}
                checked={checked}
                onChange={() => {
                  if (q.type === 'single') onChange({ optionIds: [o.id] });
                  else onChange({ optionIds: checked ? optionIds.filter((x) => x !== o.id) : [...optionIds, o.id] });
                }}
              />
              {o.label}
            </label>
          );
        })
      )}
    </div>
  );
}
