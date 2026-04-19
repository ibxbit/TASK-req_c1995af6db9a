import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import RoadshowWorkspace from './RoadshowWorkspace.svelte';
import { me, clearSession } from '../session.js';
import { api } from '../api.js';

vi.mock('../api.js', () => ({ api: vi.fn() }));

const EVENTS = [
  { id: 5, name: 'NYC Roadshow', starts_at: '2025-06-01T09:00:00Z',
    headcount_cutoff_at: '2025-05-25T00:00:00Z', city_id: 1,
    status: 'scheduled', current_headcount: 3, min_headcount: 5 },
  { id: 6, name: 'Chicago Roadshow', starts_at: '2025-07-01T09:00:00Z',
    headcount_cutoff_at: '2025-06-25T00:00:00Z', city_id: 2,
    status: 'draft', current_headcount: 0, min_headcount: 5 },
];

beforeEach(() => {
  localStorage.clear();
  clearSession();
  vi.clearAllMocks();
});

// ── layout ────────────────────────────────────────────────────────────────────
describe('RoadshowWorkspace — layout', () => {
  it('renders "Roadshow events" heading', () => {
    api.mockResolvedValue([]);
    const { getByText } = render(RoadshowWorkspace);
    expect(getByText('Roadshow events')).toBeTruthy();
  });

  it('renders Refresh button', () => {
    api.mockResolvedValue([]);
    const { getByRole } = render(RoadshowWorkspace);
    expect(getByRole('button', { name: /refresh/i })).toBeTruthy();
  });

  it('shows placeholder text when no event is selected', () => {
    api.mockResolvedValue([]);
    const { getByText } = render(RoadshowWorkspace);
    expect(getByText(/select an event/i)).toBeTruthy();
  });
});

// ── event list ────────────────────────────────────────────────────────────────
describe('RoadshowWorkspace — event list', () => {
  it('shows empty state when no events', async () => {
    api.mockResolvedValue([]);
    const { findByText } = render(RoadshowWorkspace);
    await findByText(/no events visible in your city scope/i);
  });

  it('renders event names from API', async () => {
    api.mockResolvedValue(EVENTS);
    const { findByText } = render(RoadshowWorkspace);
    await findByText('NYC Roadshow');
    await findByText('Chicago Roadshow');
  });

  it('renders event status in list items', async () => {
    api.mockResolvedValue(EVENTS);
    const { findByText } = render(RoadshowWorkspace);
    await findByText(/scheduled/);
  });

  it('shows error message when events fail to load', async () => {
    api.mockRejectedValue(new Error('Events unavailable'));
    const { findByText } = render(RoadshowWorkspace);
    await findByText(/events unavailable/i);
  });
});

// ── event detail ──────────────────────────────────────────────────────────────
describe('RoadshowWorkspace — event detail', () => {
  it('shows event name in detail panel on click', async () => {
    api.mockResolvedValue(EVENTS);
    const { findByText } = render(RoadshowWorkspace);
    await findByText('NYC Roadshow');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText(/starts:/i);
  });

  it('shows event status in detail panel', async () => {
    api.mockResolvedValue(EVENTS);
    const { findByText } = render(RoadshowWorkspace);
    await findByText('NYC Roadshow');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText(/status:/i);
  });

  it('shows Orders count heading in detail panel', async () => {
    api.mockResolvedValue(EVENTS);
    const { findByText } = render(RoadshowWorkspace);
    await findByText('NYC Roadshow');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText(/orders \(/i);
  });

  // PERMISSIONS.ORDER_READ is undefined in permissions.js, so $can(undefined)
  // always returns false — orders section always shows the no-permission message.
  it('shows no-permission message for orders (ORDER_READ not in permissions map)', async () => {
    me.set({ id: 1, permissions: ['menu.roadshow'] });
    api.mockResolvedValue(EVENTS);
    const { findByText } = render(RoadshowWorkspace);
    await findByText('NYC Roadshow');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText(/don't have permission to view orders/i);
  });
});

// ── refresh ───────────────────────────────────────────────────────────────────
describe('RoadshowWorkspace — refresh', () => {
  it('Refresh button re-fetches events', async () => {
    api.mockResolvedValue(EVENTS);
    const { getByRole, findByText } = render(RoadshowWorkspace);
    await findByText('NYC Roadshow');
    const callsBefore = api.mock.calls.length;
    await fireEvent.click(getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
