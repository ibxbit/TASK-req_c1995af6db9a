import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import OrdersView from './OrdersView.svelte';
import { clearSession } from '../session.js';
import { api } from '../api.js';

vi.mock('../api.js', () => ({ api: vi.fn() }));

const ORDERS = [
  { id: 1, order_number: 'ORD-0001', status: 'active',   total_amount_cents: 100000, currency: 'USD', event_id: 5, customer_name: 'Acme Corp' },
  { id: 2, order_number: 'ORD-0002', status: 'canceled', total_amount_cents: 50000,  currency: 'USD', event_id: 6, customer_name: 'Globex Ltd' },
];
const ORDER_DETAIL = {
  ...ORDERS[0],
  stages: [
    { id: 10, sequence: 1, label: 'Deposit', amount_cents: 50000, due_at: '2025-01-01T00:00:00Z',
      status: 'paid', invoice_number: 'INV-001', receipt_number: 'RCP-001',
      paid_at: '2025-01-02T00:00:00Z', refund_number: null },
    { id: 11, sequence: 2, label: 'Balance', amount_cents: 50000, due_at: '2025-06-01T00:00:00Z',
      status: 'invoiced', invoice_number: 'INV-002', receipt_number: null,
      paid_at: null, refund_number: null },
  ],
  line_items: [],
};

beforeEach(() => {
  localStorage.clear();
  clearSession();
  vi.clearAllMocks();
});

// ── layout ────────────────────────────────────────────────────────────────────
describe('OrdersView — layout', () => {
  it('renders Orders heading', () => {
    api.mockResolvedValue([]);
    const { getByText } = render(OrdersView);
    expect(getByText('Orders')).toBeTruthy();
  });

  it('shows "Select an order" placeholder when nothing selected', () => {
    api.mockResolvedValue([]);
    const { getByText } = render(OrdersView);
    expect(getByText(/select an order/i)).toBeTruthy();
  });

  it('renders Refresh button', () => {
    api.mockResolvedValue([]);
    const { getByRole } = render(OrdersView);
    expect(getByRole('button', { name: /refresh/i })).toBeTruthy();
  });
});

// ── order list ────────────────────────────────────────────────────────────────
describe('OrdersView — order list', () => {
  it('shows empty state when no orders', async () => {
    api.mockResolvedValue([]);
    const { findByText } = render(OrdersView);
    await findByText(/no orders in your scope/i);
  });

  it('renders order numbers from API', async () => {
    api.mockResolvedValue(ORDERS);
    const { findByText } = render(OrdersView);
    await findByText('ORD-0001');
    await findByText('ORD-0002');
  });

  it('renders order status and amount in list items', async () => {
    api.mockResolvedValue(ORDERS);
    const { findByText } = render(OrdersView);
    await findByText(/active/);
    await findByText(/1000\.00 USD/);
  });

  it('shows error message when list load fails', async () => {
    api.mockRejectedValue(new Error('Network failure'));
    const { findByText } = render(OrdersView);
    await findByText(/network failure/i);
  });
});

// ── order detail ──────────────────────────────────────────────────────────────
describe('OrdersView — order detail', () => {
  it('loads and renders order detail on click', async () => {
    api.mockResolvedValueOnce(ORDERS)             // initial list
      .mockResolvedValueOnce(ORDER_DETAIL);       // detail load
    const { findByText } = render(OrdersView);
    await findByText('ORD-0001');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText('Acme Corp');
    await findByText(/payment stages/i);
  });

  it('shows payment stages heading in detail view', async () => {
    api.mockResolvedValueOnce(ORDERS).mockResolvedValueOnce(ORDER_DETAIL);
    const { findByText } = render(OrdersView);
    await findByText('ORD-0001');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText(/payment stages/i);
  });

  it('renders stage rows with label, amount, status', async () => {
    api.mockResolvedValueOnce(ORDERS).mockResolvedValueOnce(ORDER_DETAIL);
    const { findByText } = render(OrdersView);
    await findByText('ORD-0001');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText('Deposit');
    await findByText('Balance');
    await findByText('paid');
    await findByText('invoiced');
  });

  it('shows receipt number when stage is paid', async () => {
    api.mockResolvedValueOnce(ORDERS).mockResolvedValueOnce(ORDER_DETAIL);
    const { findByText } = render(OrdersView);
    await findByText('ORD-0001');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText(/RCP-001/);
  });

  it('shows customer name and event id', async () => {
    api.mockResolvedValueOnce(ORDERS).mockResolvedValueOnce(ORDER_DETAIL);
    const { findByText } = render(OrdersView);
    await findByText('ORD-0001');
    await fireEvent.click(document.querySelector('button.link'));
    await findByText(/Acme Corp/);
    await findByText(/event #5/i);
  });
});

// ── refresh button ─────────────────────────────────────────────────────────────
describe('OrdersView — refresh', () => {
  it('Refresh button re-fetches orders', async () => {
    api.mockResolvedValue(ORDERS);
    const { getByRole, findByText } = render(OrdersView);
    await findByText('ORD-0001');
    const callsBefore = api.mock.calls.length;
    await fireEvent.click(getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
