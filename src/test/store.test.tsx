import { describe, expect, it } from 'vitest';
import { createStore } from '../state/store';
import { saveState, loadState } from '../state/persistence';
import { memoryStorage } from './memoryStorage';
import { buildSampleState } from '../domain/seed';

const STORAGE_KEY = 'storedraft:state:v1';
const NOW = 1_758_000_000_000;

describe('撤销 / 重做', () => {
  it('编辑答案可撤销再重做', () => {
    const store = createStore(memoryStorage());
    const before = store.getState().drafts[0].answers.find((a) => a.questionKey === 'q_ads')?.optionIds;
    store.setAnswer(store.getState().drafts[0].id, 'q_ads', { optionIds: ['ads_thirdparty'] });
    expect(store.getState().drafts[0].answers.find((a) => a.questionKey === 'q_ads')?.optionIds).toEqual(['ads_thirdparty']);
    expect(store.canUndo()).toBe(true);

    store.undo();
    expect(store.getState().drafts[0].answers.find((a) => a.questionKey === 'q_ads')?.optionIds).toEqual(before);
    expect(store.canRedo()).toBe(true);

    store.redo();
    expect(store.getState().drafts[0].answers.find((a) => a.questionKey === 'q_ads')?.optionIds).toEqual(['ads_thirdparty']);
  });

  it('撤销后再编辑会清空重做栈', () => {
    const store = createStore(memoryStorage());
    store.setAnswer(store.getState().drafts[0].id, 'q_ads', { optionIds: ['ads_no'] });
    store.undo();
    expect(store.canRedo()).toBe(true);
    store.setAnswer(store.getState().drafts[0].id, 'q_ads', { optionIds: ['ads_self'] });
    expect(store.canRedo()).toBe(false);
  });
});

describe('刷新恢复', () => {
  it('每次提交写入 localStorage，新 store 从持久化状态恢复', () => {
    const storage = memoryStorage();
    const store = createStore(storage);
    store.setAnswer(store.getState().drafts[0].id, 'q_collect', { optionIds: ['no'] });
    const frozenName = store.getState().versions[0].name;
    store.freezeBatch('恢复前冻结的批次', [store.getState().drafts[0].id]);
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();

    // 模拟刷新：重新创建 store
    const restored = createStore(storage);
    expect(restored.getState().drafts[0].answers.find((a) => a.questionKey === 'q_collect')?.optionIds).toEqual(['no']);
    expect(restored.getState().batches).toHaveLength(1);
    expect(restored.getState().batches[0].label).toBe('恢复前冻结的批次');
    expect(restored.getState().versions[0].name).toBe(frozenName);
  });

  it('无持久化数据时回退到内置样例；损坏数据被忽略', () => {
    const empty = createStore(memoryStorage());
    expect(empty.getState().drafts.length).toBeGreaterThan(0);

    const broken = memoryStorage({ [STORAGE_KEY]: '{not json' });
    const store2 = createStore(broken);
    expect(store2.getState().versions.length).toBe(2);
  });

  it('持久化保存的是完整 AppState（含版本/计划/审核日志）', () => {
    const storage = memoryStorage();
    const sample = buildSampleState(NOW);
    saveState(sample, NOW, storage);
    const loaded = loadState(storage);
    expect(loaded?.state.drafts).toHaveLength(sample.drafts.length);
    expect(loaded?.state.plans[0].mappings.length).toBe(sample.plans[0].mappings.length);
    expect(loaded?.savedAt).toBe(NOW);
  });
});
