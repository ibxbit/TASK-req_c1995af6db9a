import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import AdminWorkspace from './AdminWorkspace.svelte';
import { me, clearSession } from '../session.js';
import { api } from '../api.js';

vi.mock('../api.js', () => ({ api: vi.fn() }));

const USERS = [
  { id: 1, username: 'alice', full_name: 'Alice Admin', email: 'alice@example.com',
    roles: ['ADMIN'], is_active: true },
  { id: 2, username: 'bob', full_name: 'Bob User', email: 'bob@example.com',
    roles: ['FINANCE'], is_active: false },
];

const ADMIN_ME = { id: 99, permissions: ['user.manage'] };

beforeEach(() => {
  localStorage.clear();
  clearSession();
  vi.clearAllMocks();
});

// ── layout ────────────────────────────────────────────────────────────────────
describe('AdminWorkspace — layout', () => {
  it('renders "Users & roles" heading', () => {
    api.mockResolvedValue([]);
    const { getByText } = render(AdminWorkspace);
    expect(getByText('Users & roles')).toBeTruthy();
  });

  it('renders Refresh button', () => {
    api.mockResolvedValue([]);
    const { getByRole } = render(AdminWorkspace);
    expect(getByRole('button', { name: /refresh/i })).toBeTruthy();
  });
});

// ── no-permission state ───────────────────────────────────────────────────────
describe('AdminWorkspace — no permission', () => {
  it('shows no-permission message when user lacks user.manage', () => {
    me.set({ id: 1, permissions: ['menu.admin'] });
    api.mockResolvedValue([]);
    const { getByText } = render(AdminWorkspace);
    expect(getByText(/don't have permission to manage users/i)).toBeTruthy();
  });

  it('does not call /admin/users when user lacks user.manage', () => {
    me.set({ id: 1, permissions: [] });
    api.mockResolvedValue([]);
    render(AdminWorkspace);
    expect(api.mock.calls.some(([url]) => url === '/admin/users')).toBe(false);
  });
});

// ── user table ────────────────────────────────────────────────────────────────
describe('AdminWorkspace — user table', () => {
  it('renders table column headers with user.manage permission', async () => {
    me.set(ADMIN_ME);
    api.mockResolvedValue(USERS);
    const { findByText } = render(AdminWorkspace);
    await findByText('Username');
    await findByText('Name');
    await findByText('Email');
    await findByText('Roles');
  });

  it('renders user rows after load', async () => {
    me.set(ADMIN_ME);
    api.mockResolvedValue(USERS);
    const { findByText } = render(AdminWorkspace);
    await findByText('alice');
    await findByText('Alice Admin');
    await findByText('alice@example.com');
  });

  it('shows empty state when no users', async () => {
    me.set(ADMIN_ME);
    api.mockResolvedValue([]);
    const { findByText } = render(AdminWorkspace);
    await findByText(/no users/i);
  });

  it('shows error message when user load fails', async () => {
    me.set(ADMIN_ME);
    api.mockRejectedValue(new Error('Admin service error'));
    const { findByText } = render(AdminWorkspace);
    await findByText(/admin service error/i);
  });
});

// ── create form ───────────────────────────────────────────────────────────────
describe('AdminWorkspace — create form', () => {
  it('renders Create user heading', async () => {
    me.set(ADMIN_ME);
    api.mockResolvedValue(USERS);
    const { findByText } = render(AdminWorkspace);
    await findByText('Create user');
  });

  it('renders create form inputs', async () => {
    me.set(ADMIN_ME);
    api.mockResolvedValue(USERS);
    const { container, findByText } = render(AdminWorkspace);
    await findByText('Create user');
    const inputs = container.querySelectorAll('form.create input');
    expect(inputs.length).toBeGreaterThanOrEqual(4);
  });

  it('renders Create submit button in form', async () => {
    me.set(ADMIN_ME);
    api.mockResolvedValue(USERS);
    const { findByRole } = render(AdminWorkspace);
    await findByRole('button', { name: /^create$/i });
  });

  it('calls /admin/users POST on form submit', async () => {
    me.set(ADMIN_ME);
    api
      .mockResolvedValueOnce(USERS)   // initial load
      .mockResolvedValueOnce({})      // POST create
      .mockResolvedValueOnce(USERS);  // refresh after create
    const { container, findByRole } = render(AdminWorkspace);
    await findByRole('button', { name: /^create$/i });

    const [uInput, eInput, nInput, pInput] = container.querySelectorAll('form.create input');
    await fireEvent.input(uInput, { target: { value: 'newuser' } });
    await fireEvent.input(eInput, { target: { value: 'new@example.com' } });
    await fireEvent.input(nInput, { target: { value: 'New User' } });
    await fireEvent.input(pInput, { target: { value: 'password123' } });

    const createBtn = await findByRole('button', { name: /^create$/i });
    await fireEvent.click(createBtn);

    await waitFor(() => {
      expect(api.mock.calls.some(([url, opts]) =>
        url === '/admin/users' && opts?.method === 'POST'
      )).toBe(true);
    });
  });

  it('shows error when create fails', async () => {
    me.set(ADMIN_ME);
    api
      .mockResolvedValueOnce(USERS)
      .mockRejectedValueOnce(new Error('Username taken'));
    const { container, findByRole, findByText } = render(AdminWorkspace);
    await findByRole('button', { name: /^create$/i });

    const [uInput, eInput, nInput, pInput] = container.querySelectorAll('form.create input');
    await fireEvent.input(uInput, { target: { value: 'alice' } });
    await fireEvent.input(eInput, { target: { value: 'alice@example.com' } });
    await fireEvent.input(nInput, { target: { value: 'Alice' } });
    await fireEvent.input(pInput, { target: { value: 'pass' } });

    const createBtn = await findByRole('button', { name: /^create$/i });
    await fireEvent.click(createBtn);
    await findByText(/username taken/i);
  });
});

// ── unlock action ─────────────────────────────────────────────────────────────
describe('AdminWorkspace — unlock', () => {
  it('renders Unlock button per user row', async () => {
    me.set(ADMIN_ME);
    api.mockResolvedValue(USERS);
    const { findAllByRole } = render(AdminWorkspace);
    const unlockBtns = await findAllByRole('button', { name: /unlock/i });
    expect(unlockBtns.length).toBe(USERS.length);
  });

  it('calls unlock endpoint when Unlock is clicked', async () => {
    me.set(ADMIN_ME);
    api
      .mockResolvedValueOnce(USERS)
      .mockResolvedValueOnce({})     // unlock POST
      .mockResolvedValueOnce(USERS); // refresh
    const { findAllByRole } = render(AdminWorkspace);
    const unlockBtns = await findAllByRole('button', { name: /unlock/i });
    await fireEvent.click(unlockBtns[0]);
    await waitFor(() => {
      expect(api.mock.calls.some(([url, opts]) =>
        url.includes('/unlock') && opts?.method === 'POST'
      )).toBe(true);
    });
  });
});

// ── refresh ───────────────────────────────────────────────────────────────────
describe('AdminWorkspace — refresh', () => {
  it('Refresh button re-fetches users', async () => {
    me.set(ADMIN_ME);
    api.mockResolvedValue(USERS);
    const { getByRole, findByText } = render(AdminWorkspace);
    await findByText('alice');
    const callsBefore = api.mock.calls.length;
    await fireEvent.click(getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
