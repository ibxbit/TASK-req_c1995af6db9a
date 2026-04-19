import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import AuditWorkspace from './AuditWorkspace.svelte';
import { clearSession } from '../session.js';
import { api } from '../api.js';

vi.mock('../api.js', () => ({ api: vi.fn() }));

const EVENTS = [
  { id: 1, occurred_at: '2025-01-10T10:00:00Z', user_id: 2, username: 'alice',
    action: 'order.create', entity_type: 'order', entity_id: 42,
    granted: true, workstation: 'WS-1', reason: null },
  { id: 2, occurred_at: '2025-01-10T11:00:00Z', user_id: 3, username: 'bob',
    action: 'admin.unlock', entity_type: 'user', entity_id: 7,
    granted: false, workstation: 'WS-2', reason: 'Denied — insufficient role' },
];

const BY_ACTION = [
  { action: 'order.create', total: 50, denied: 2, last_event: '2025-01-10T10:00:00Z' },
  { action: 'admin.unlock', total: 5,  denied: 3, last_event: '2025-01-10T11:00:00Z' },
];

const RETENTION = {
  retention_years: 7,
  oldest_permission_event: '2018-01-01T00:00:00Z',
  oldest_stock_ledger: '2019-03-15T00:00:00Z',
  oldest_payment_attempt: '2020-06-01T00:00:00Z',
};

function mockApiSuccess(events = EVENTS, byAction = BY_ACTION, retention = RETENTION) {
  api.mockImplementation((path) => {
    if (path.startsWith('/audit/events')) return Promise.resolve(events);
    if (path === '/audit/stats/by-action') return Promise.resolve(byAction);
    if (path === '/audit/retention') return Promise.resolve(retention);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  localStorage.clear();
  clearSession();
  vi.clearAllMocks();
});

// ── layout ────────────────────────────────────────────────────────────────────
describe('AuditWorkspace — layout', () => {
  it('renders "Audit log" heading', () => {
    mockApiSuccess();
    const { getByText } = render(AuditWorkspace);
    expect(getByText('Audit log')).toBeTruthy();
  });

  it('renders Refresh button', () => {
    mockApiSuccess();
    const { getByRole } = render(AuditWorkspace);
    expect(getByRole('button', { name: /^refresh$/i })).toBeTruthy();
  });

  it('renders filter form with expected placeholders', () => {
    mockApiSuccess();
    const { container } = render(AuditWorkspace);
    const inputs = container.querySelectorAll('form input');
    expect(inputs.length).toBeGreaterThanOrEqual(5);
  });

  it('renders Apply button in filter form', () => {
    mockApiSuccess();
    const { getByRole } = render(AuditWorkspace);
    expect(getByRole('button', { name: /apply/i })).toBeTruthy();
  });

  it('renders "Action breakdown" section heading', () => {
    mockApiSuccess();
    const { getByText } = render(AuditWorkspace);
    expect(getByText('Action breakdown')).toBeTruthy();
  });

  it('renders "Recent events" section heading', () => {
    mockApiSuccess();
    const { getByText } = render(AuditWorkspace);
    expect(getByText('Recent events')).toBeTruthy();
  });
});

// ── data rendering ────────────────────────────────────────────────────────────
describe('AuditWorkspace — data rendering', () => {
  it('shows retention info after load', async () => {
    mockApiSuccess();
    const { findByText } = render(AuditWorkspace);
    await findByText(/retention.*7y/i);
  });

  it('renders action breakdown rows', async () => {
    mockApiSuccess();
    const { findAllByText } = render(AuditWorkspace);
    const els = await findAllByText(/order\.create/);
    expect(els.length).toBeGreaterThan(0);
    await findAllByText(/admin\.unlock/);
  });

  it('renders recent event usernames', async () => {
    mockApiSuccess();
    const { findByText } = render(AuditWorkspace);
    await findByText('alice');
    await findByText('bob');
  });

  it('renders recent event actions', async () => {
    mockApiSuccess();
    const { findAllByText } = render(AuditWorkspace);
    const els = await findAllByText(/order\.create/);
    expect(els.length).toBeGreaterThan(0);
  });

  it('shows empty state when no audit events matched', async () => {
    mockApiSuccess([]);
    const { findByText } = render(AuditWorkspace);
    await findByText(/no audit events matched/i);
  });
});

// ── error state ───────────────────────────────────────────────────────────────
describe('AuditWorkspace — error state', () => {
  it('shows error message when API fails', async () => {
    api.mockRejectedValue(new Error('Audit service down'));
    const { findByText } = render(AuditWorkspace);
    await findByText(/audit service down/i);
  });
});

// ── refresh interaction ───────────────────────────────────────────────────────
describe('AuditWorkspace — refresh', () => {
  it('Refresh button triggers new API call', async () => {
    mockApiSuccess();
    const { getByRole, findByText } = render(AuditWorkspace);
    await findByText('alice');
    const callsBefore = api.mock.calls.length;
    await fireEvent.click(getByRole('button', { name: /^refresh$/i }));
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('Apply filter button re-fetches events', async () => {
    mockApiSuccess();
    const { getByRole, findByText } = render(AuditWorkspace);
    await findByText('alice');
    const callsBefore = api.mock.calls.length;
    await fireEvent.click(getByRole('button', { name: /apply/i }));
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('clears error on successful refresh after failure', async () => {
    api.mockRejectedValueOnce(new Error('Transient failure'));
    mockApiSuccess();
    const { findByText, queryByText, getByRole } = render(AuditWorkspace);
    await findByText(/transient failure/i);
    await fireEvent.click(getByRole('button', { name: /^refresh$/i }));
    await waitFor(() => expect(queryByText(/transient failure/i)).toBeNull());
  });
});
