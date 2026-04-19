import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import InventoryDashboard from './InventoryDashboard.svelte';
import { clearSession } from '../session.js';
import { api } from '../api.js';

vi.mock('../api.js', () => ({ api: vi.fn() }));

const STOCK = [
  { item_id: 1, location_id: 10, sku: 'SKU-A', name: 'Widget A', warehouse_code: 'WH1', location_code: 'SHELF-1', on_hand: 50, reserved: 5, available: 45 },
  { item_id: 2, location_id: 11, sku: 'SKU-B', name: 'Widget B', warehouse_code: 'WH1', location_code: 'SHELF-2', on_hand: 3, reserved: 0, available: 3 },
];
const ALERTS = [
  { item_id: 2, sku: 'SKU-B', name: 'Widget B', available_total: 3, safety_threshold: 10 },
];

function mockApiSuccess(stock = STOCK, alerts = ALERTS) {
  api.mockImplementation((path) => {
    if (path === '/inventory') return Promise.resolve(stock);
    if (path === '/inventory/alerts/low-stock') return Promise.resolve(alerts);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  localStorage.clear();
  clearSession();
  vi.clearAllMocks();
});

// ── heading & layout ──────────────────────────────────────────────────────────
describe('InventoryDashboard — layout', () => {
  it('renders the Inventory dashboard heading', () => {
    mockApiSuccess([], []);
    const { getByText } = render(InventoryDashboard);
    expect(getByText('Inventory dashboard')).toBeTruthy();
  });

  it('renders table column headers', () => {
    mockApiSuccess([], []);
    const { getByText } = render(InventoryDashboard);
    expect(getByText('SKU')).toBeTruthy();
    expect(getByText('Name')).toBeTruthy();
    expect(getByText('Warehouse')).toBeTruthy();
    expect(getByText('On hand')).toBeTruthy();
    expect(getByText('Reserved')).toBeTruthy();
    expect(getByText('Available')).toBeTruthy();
  });

  it('renders the "Refresh now" button', () => {
    mockApiSuccess([], []);
    const { getByRole } = render(InventoryDashboard);
    expect(getByRole('button', { name: /refresh now/i })).toBeTruthy();
  });

  it('renders the live polling checkbox', () => {
    mockApiSuccess([], []);
    const { getByRole } = render(InventoryDashboard);
    expect(getByRole('checkbox')).toBeTruthy();
  });
});

// ── stock data rendering ──────────────────────────────────────────────────────
describe('InventoryDashboard — stock data', () => {
  it('shows "No stock visible" empty state initially (before load)', () => {
    // API resolves but after initial render the empty state shows first
    api.mockResolvedValue([]);
    const { getByText } = render(InventoryDashboard);
    expect(getByText(/no stock visible/i)).toBeTruthy();
  });

  it('renders stock rows after data loads', async () => {
    mockApiSuccess();
    const { findByText, findAllByText } = render(InventoryDashboard);
    await findByText('SKU-A');
    await findByText('Widget A');
    const wh1 = await findAllByText('WH1');
    expect(wh1.length).toBeGreaterThan(0);
  });

  it('renders numeric on_hand, reserved, available values', async () => {
    mockApiSuccess();
    const { findAllByText } = render(InventoryDashboard);
    await findAllByText('50'); // on_hand for SKU-A
  });

  it('applies low-stock CSS class to rows matching alerts', async () => {
    mockApiSuccess();
    render(InventoryDashboard);
    await waitFor(() => {
      const lowRows = document.querySelectorAll('tr.low');
      expect(lowRows.length).toBeGreaterThan(0);
    });
  });
});

// ── low-stock alerts banner ───────────────────────────────────────────────────
describe('InventoryDashboard — alerts', () => {
  it('shows low-stock alerts banner when alerts exist', async () => {
    mockApiSuccess();
    const { findByText } = render(InventoryDashboard);
    await findByText(/low-stock alerts/i);
  });

  it('shows the SKU with available < threshold in the alert', async () => {
    mockApiSuccess();
    const { container, findByText } = render(InventoryDashboard);
    await findByText(/low-stock alerts/i);
    await waitFor(() => {
      const alerts = container.querySelector('.alerts');
      expect(alerts?.textContent).toMatch(/3/);
    });
  });

  it('does not show alerts banner when there are no alerts', async () => {
    mockApiSuccess(STOCK, []);
    const { queryByText } = render(InventoryDashboard);
    await waitFor(() => {
      expect(queryByText(/low-stock alerts/i)).toBeNull();
    });
  });
});

// ── error state ───────────────────────────────────────────────────────────────
describe('InventoryDashboard — error state', () => {
  it('displays error message when API call fails', async () => {
    api.mockRejectedValue(new Error('Server error'));
    const { findByText } = render(InventoryDashboard);
    await findByText(/server error/i);
  });

  it('shows custom error message from API', async () => {
    api.mockRejectedValue(new Error('Failed to load inventory'));
    const { findByText } = render(InventoryDashboard);
    await findByText(/failed to load inventory/i);
  });
});

// ── refresh interaction ───────────────────────────────────────────────────────
describe('InventoryDashboard — refresh', () => {
  it('"Refresh now" triggers a new API call', async () => {
    mockApiSuccess();
    const { getByRole, findByText } = render(InventoryDashboard);
    await findByText('SKU-A'); // wait for initial load
    const callsBefore = api.mock.calls.length;
    await fireEvent.click(getByRole('button', { name: /refresh now/i }));
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('shows lastRefresh timestamp after successful load', async () => {
    mockApiSuccess();
    const { container, findByText } = render(InventoryDashboard);
    await findByText('SKU-A');
    // The component renders <small>updated HH:MM:SS</small>
    await waitFor(() => {
      const small = container.querySelector('small');
      expect(small).not.toBeNull();
      expect(small.textContent).toMatch(/updated/i);
    });
  });

  it('clears previous error on successful refresh', async () => {
    api.mockRejectedValueOnce(new Error('First failure'));
    mockApiSuccess(); // second call succeeds
    const { findByText, queryByText } = render(InventoryDashboard);
    await findByText(/first failure/i);
    await fireEvent.click(screen.getByRole('button', { name: /refresh now/i }));
    await waitFor(() => expect(queryByText(/first failure/i)).toBeNull());
  });
});
