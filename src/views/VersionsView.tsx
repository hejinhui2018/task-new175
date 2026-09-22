import { useState } from 'react';
import { useAppState, useStore } from '../state/store';
import { Badge, fmtTime, platformLabel } from '../components/ui';
import type { FormVersion } from '../domain/types';

export function VersionsView() {
  const state = useAppState();
  const [selectedId, setSelectedId] = useState(state.activeVersionId);
  const version = state.versions.find((v) => v.id === selectedId) ?? state.versions[0];

  return (
    <div className="grid two">
      <div className="card">
        <h2>表单版本</h2>
        {state.versions.map((v) => (
          <div
            key={v.id}
            className={`list-item ${v.id === version?.id ? 'selected' : ''}`}
            onClick={() => setSelectedId(v.id)}
          >
            <div>
              <strong>{v.name}</strong>
              {v.id === state.activeVersionId && <Badge tone="blue">当前</Badge>}
            </div>
            <div className="sub">{fmtTime(v.createdAt)}</div>
            <div className="sub">{v.questions.length} 道题 · {v.note}</div>
          </div>
        ))}
        <CloneVersion version={version} />
      </div>
      <div className="card">
        <h2>
          题目结构 <span className="muted small">{version?.name}</span>
        </h2>
        {version?.questions.map((q) => (
          <div key={q.key} className="q-card">
            <div className="q-title">
              {q.title}
              <Badge tone="gray">{q.type === 'single' ? '单选' : q.type === 'multi' ? '多选' : '文本'}</Badge>
              {q.splitFrom && <Badge tone="blue">由 {q.splitFrom} 拆分</Badge>}
            </div>
            <div className="q-meta">
              key: {q.key}
              {' · '}平台：{q.scope.platforms.map(platformLabel).join('/')}
              {' · '}地区：{q.scope.regions.includes('*') ? '全部' : q.scope.regions.join('、')}
            </div>
            {q.conditions.length > 0 && (
              <div className="q-meta">
                显示条件（AND）：
                {q.conditions.map((c, i) => (
                  <Badge key={i} tone="amber">
                    {c.questionId} = {c.optionId}
                  </Badge>
                ))}
              </div>
            )}
            {q.options.length > 0 && (
              <div className="q-meta">
                选项：
                {q.options.map((o) => `${o.id}（${o.label}）`).join('、')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CloneVersion({ version }: { version?: FormVersion }) {
  const store = useStore();
  const [name, setName] = useState('');
  if (!version) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <h3>克隆为新版本（用于试验改题/改条件）</h3>
      <div className="inline-form">
        <input
          placeholder="新版本名称，如 2026 资料表 v3"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="primary tiny"
          disabled={!name.trim()}
          onClick={() => {
            const id = `form-clone-${Date.now().toString(36)}`;
            store.addVersion({
              ...version,
              id,
              name: name.trim(),
              createdAt: Date.now(),
              note: `从 ${version.name} 克隆`,
              questions: version.questions.map((q) => ({
                ...q,
                options: q.options.map((o) => ({ ...o })),
                conditions: q.conditions.map((c) => ({ ...c })),
                scope: { platforms: [...q.scope.platforms], regions: [...q.scope.regions] },
              })),
            });
            setName('');
          }}
        >
          克隆并新建
        </button>
      </div>
    </div>
  );
}
