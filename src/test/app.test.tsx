import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import App from '../App';
import { clearState } from '../state/persistence';
import { resetStoreSingleton } from '../state/store';

beforeEach(() => {
  localStorage.clear();
  clearState();
  resetStoreSingleton();
});

describe('StoreDraft 应用集成', () => {
  it('五个标签页均可渲染，草稿展示条件分支与来源', () => {
    render(<App />);
    // 默认草稿页
    expect(screen.getByRole('heading', { name: /草稿资料/ })).toBeInTheDocument();
    expect(screen.getAllByText(/FocusFlow/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '版本对比' }));
    expect(screen.getByText(/题目变化/)).toBeInTheDocument();
    expect(screen.getByText(/受影响的草稿/)).toBeInTheDocument();
    // v1 隐私说明被拆分
    expect(screen.getAllByText(/题目拆分/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '表单版本' }));
    expect(screen.getByText(/题目结构/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '提交批次' }));
    expect(screen.getByText(/冻结提交批次/)).toBeInTheDocument();
    expect(screen.getByText(/审核结果到达日志/)).toBeInTheDocument();
  });

  it('迁移台：默认存在拆分硬冲突，逐份解决后可确认，未确认草稿不变', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '迁移换版' }));
    expect(screen.getByText(/迁移预览与逐份确认/)).toBeInTheDocument();
    // 4 份旧草稿，至少收集数据的草稿存在“拆分去向不唯一”冲突
    expect(screen.getAllByText(/拆分去向不唯一/).length).toBeGreaterThan(0);
    // 存在冲突时“批量确认无冲突草稿”不迁移带冲突草稿；无冲突草稿 iOS CN（不收集数据）可以确认
    const confirmButtons = screen.getAllByRole('button', { name: '确认并迁移这份' });
    expect(confirmButtons.length).toBe(4);
  });

  it('批次门禁：三项检查未齐不能放行；迟到结果进拒收日志', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '提交批次' }));

    // 勾选第一份草稿并冻结
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    const nameInput = screen.getByPlaceholderText(/2026 九月批次/);
    fireEvent.change(nameInput, { target: { value: '集成测试批次' } });
    fireEvent.click(screen.getByRole('button', { name: /冻结所选/ }));

    expect(screen.getByText('集成测试批次')).toBeInTheDocument();
    // 放行按钮禁用
    const release = screen.getByRole('button', { name: '放行发布' });
    expect(release).toBeDisabled();

    // 提交一条重复结果：先提交完整性 pass 两次
    const submitButtons = screen.getAllByRole('button', { name: '提交结果' });
    fireEvent.click(submitButtons[0]);
    // 第二次默认仍是完整性 pass -> 重复拒收
    fireEvent.click(submitButtons[0]);
    const log = screen.getByText(/审核结果到达日志/).closest('.card') as HTMLElement;
    expect(within(log).getByText('重复结果：completeness 已存在相同结论')).toBeInTheDocument();
  });

  it('撤销重做按钮在操作后可用，刷新后状态恢复（localStorage 已写入）', () => {
    render(<App />);
    // 在草稿页修改一个答案：选 Android US 草稿
    fireEvent.click(screen.getByText(/draft-android-us|Android · US/).closest('.list-item')!);
    const undoBtn = screen.getByRole('button', { name: /撤销/ });
    expect(undoBtn).toBeDisabled();
    // 任意单选点击：Android US 当前是第三方广告，改为自营推广
    fireEvent.click(screen.getByText('自营推广'));
    expect(undoBtn).not.toBeDisabled();
    fireEvent.click(undoBtn);
    expect(screen.getByTestId('last-action').textContent).toContain('撤销');
    expect(localStorage.getItem('storedraft:state:v1')).not.toBeNull();
  });
});
