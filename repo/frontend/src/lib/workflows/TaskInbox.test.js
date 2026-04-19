import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import TaskInbox from './TaskInbox.svelte';
import { me, clearSession } from '../session.js';
import { api } from '../api.js';

vi.mock('../api.js', () => ({ api: vi.fn() }));

const TASKS = [
  { id: 1, step_name: 'Manager Approval', entity_type: 'order', entity_id: 42,
    instance_id: 100, due_at: '2025-06-01T00:00:00Z', is_overdue: false },
  { id: 2, step_name: 'Finance Review', entity_type: 'expense', entity_id: 7,
    instance_id: 101, due_at: '2025-01-01T00:00:00Z', is_overdue: true },
];

const INSTANCE = {
  id: 100, entity_type: 'order', entity_id: 42, definition_code: 'order_approval',
  status: 'active', summary: 'Needs approval', payload: { total: 100 },
  tasks: [
    { id: 1, sequence: 1, step_name: 'Manager Approval', status: 'open',
      decision: null, is_overdue: false, validation_errors: [] },
  ],
};

const APPROVER_ME = {
  id: 1, permissions: ['approval.approve', 'approval.reject'],
};

beforeEach(() => {
  localStorage.clear();
  clearSession();
  vi.resetAllMocks();
});

// ── layout ────────────────────────────────────────────────────────────────────
describe('TaskInbox — layout', () => {
  it('renders "My tasks" heading', () => {
    api.mockResolvedValue([]);
    const { getByText } = render(TaskInbox);
    expect(getByText('My tasks')).toBeTruthy();
  });

  it('renders Refresh button', () => {
    api.mockResolvedValue([]);
    const { getByRole } = render(TaskInbox);
    expect(getByRole('button', { name: /refresh/i })).toBeTruthy();
  });

  it('shows placeholder text when no task is selected', () => {
    api.mockResolvedValue([]);
    const { getByText } = render(TaskInbox);
    expect(getByText(/select a task/i)).toBeTruthy();
  });
});

// ── task list ─────────────────────────────────────────────────────────────────
describe('TaskInbox — task list', () => {
  it('shows empty state when no tasks', async () => {
    api.mockResolvedValue([]);
    const { findByText } = render(TaskInbox);
    await findByText(/no open tasks assigned to your role/i);
  });

  it('renders task step names from API', async () => {
    api.mockResolvedValue(TASKS);
    const { findByText } = render(TaskInbox);
    await findByText('Manager Approval');
    await findByText('Finance Review');
  });

  it('renders entity type and id in task list items', async () => {
    api.mockResolvedValue(TASKS);
    const { findByText } = render(TaskInbox);
    await findByText(/order.*42/i);
  });

  it('marks overdue tasks with OVERDUE label', async () => {
    api.mockResolvedValue(TASKS);
    const { findByText } = render(TaskInbox);
    await findByText('OVERDUE');
  });

  it('shows error message when task list fails to load', async () => {
    api.mockRejectedValue(new Error('Network error'));
    const { findByText } = render(TaskInbox);
    await findByText(/network error/i);
  });
});

// ── task detail ───────────────────────────────────────────────────────────────
describe('TaskInbox — task detail', () => {
  it('loads and renders instance detail on task click', async () => {
    api.mockResolvedValueOnce(TASKS).mockResolvedValueOnce(INSTANCE);
    const { findByText } = render(TaskInbox);
    await findByText('Manager Approval');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText('order_approval');
    await findByText('Needs approval');
  });

  it('shows instance status in detail view', async () => {
    api.mockResolvedValueOnce(TASKS).mockResolvedValueOnce(INSTANCE);
    const { findByText } = render(TaskInbox);
    await findByText('Manager Approval');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText(/active/);
  });

  it('renders Payload section heading', async () => {
    api.mockResolvedValueOnce(TASKS).mockResolvedValueOnce(INSTANCE);
    const { findByText } = render(TaskInbox);
    await findByText('Manager Approval');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText('Payload');
  });

  it('renders Task chain section heading', async () => {
    api.mockResolvedValueOnce(TASKS).mockResolvedValueOnce(INSTANCE);
    const { findByText } = render(TaskInbox);
    await findByText('Manager Approval');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText(/task chain/i);
  });

  it('renders notes textarea in detail view', async () => {
    api.mockResolvedValueOnce(TASKS).mockResolvedValueOnce(INSTANCE);
    const { findByText, container } = render(TaskInbox);
    await findByText('Manager Approval');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText('Payload');
    await waitFor(() => {
      expect(container.querySelector('textarea')).not.toBeNull();
    });
  });

  it('renders Approve, Reject, and Return for changes buttons', async () => {
    me.set(APPROVER_ME);
    api.mockResolvedValueOnce(TASKS).mockResolvedValueOnce(INSTANCE);
    const { findByText, findByRole } = render(TaskInbox);
    await findByText('Manager Approval');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText('order_approval');
    await findByRole('button', { name: /^approve$/i });
    await findByRole('button', { name: /^reject$/i });
    await findByRole('button', { name: /return for changes/i });
  });
});

// ── approve/reject actions ────────────────────────────────────────────────────
describe('TaskInbox — approve/reject actions', () => {
  it('calls approve endpoint on Approve click', async () => {
    me.set(APPROVER_ME);
    api
      .mockResolvedValueOnce(TASKS)
      .mockResolvedValueOnce(INSTANCE)
      .mockResolvedValueOnce({})   // approve POST
      .mockResolvedValueOnce([]);  // refresh after
    const { findByText, findByRole } = render(TaskInbox);
    await findByText('Manager Approval');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText('order_approval');
    const approveBtn = await findByRole('button', { name: /^approve$/i });
    await fireEvent.click(approveBtn);
    await waitFor(() => {
      const calls = api.mock.calls;
      expect(calls.some(([url]) => url.includes('/approve'))).toBe(true);
    });
  });

  it('calls reject endpoint on Reject click', async () => {
    me.set(APPROVER_ME);
    api
      .mockResolvedValueOnce(TASKS)
      .mockResolvedValueOnce(INSTANCE)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([]);
    const { findByText, findByRole } = render(TaskInbox);
    await findByText('Manager Approval');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText('order_approval');
    const rejectBtn = await findByRole('button', { name: /^reject$/i });
    await fireEvent.click(rejectBtn);
    await waitFor(() => {
      const calls = api.mock.calls;
      expect(calls.some(([url]) => url.includes('/reject'))).toBe(true);
    });
  });

  it('shows error when decide API call fails', async () => {
    me.set(APPROVER_ME);
    api
      .mockResolvedValueOnce(TASKS)
      .mockResolvedValueOnce(INSTANCE)
      .mockRejectedValueOnce(new Error('Action failed'));
    const { findByText, findByRole } = render(TaskInbox);
    await findByText('Manager Approval');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText('order_approval');
    const approveBtn = await findByRole('button', { name: /^approve$/i });
    await fireEvent.click(approveBtn);
    await findByText(/action failed/i);
  });
});

// ── refresh ───────────────────────────────────────────────────────────────────
describe('TaskInbox — refresh', () => {
  it('Refresh button re-fetches task list', async () => {
    api.mockResolvedValue(TASKS);
    const { getByRole, findByText } = render(TaskInbox);
    await findByText('Manager Approval');
    const callsBefore = api.mock.calls.length;
    await fireEvent.click(getByRole('button', { name: /^refresh$/i }));
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
