<script>
  import { onMount } from 'svelte';
  import { api } from '../api.js';

  let orders = [];
  let selected = null;
  let error = '';

  async function refresh() {
    try { orders = await api('/orders'); error = ''; }
    catch (e) { error = e.message; }
  }
  async function open(id) {
    try { selected = await api(`/orders/${id}`); }
    catch (e) { error = e.message; }
  }

  const money = (c, ccy = 'USD') => `${(c / 100).toFixed(2)} ${ccy}`;
  const fmt   = (ts) => ts ? new Date(ts).toLocaleString() : '—';

  onMount(refresh);
</script>

<section class="wrap">
  <aside>
    <h3>Orders</h3>
    <button class="small" on:click={refresh}>Refresh</button>
    <ul class="plain">
      {#each orders as o (o.id)}
        <li>
          <button class="link" class:active={selected?.id === o.id} on:click={() => open(o.id)}>
            <strong>{o.order_number}</strong>
            <small>{o.status} · {money(o.total_amount_cents, o.currency)}</small>
          </button>
        </li>
      {:else}
        <li><em>No orders in your scope.</em></li>
      {/each}
    </ul>
  </aside>

  <main>
    {#if error}<p class="error">{error}</p>{/if}
    {#if !selected}
      <p>Select an order to view payment stages and fulfillment.</p>
    {:else}
      <header class="row">
        <h3>{selected.order_number} <small>({selected.status})</small></h3>
        <span>{money(selected.total_amount_cents, selected.currency)}</span>
      </header>
      <p>Customer: <strong>{selected.customer_name}</strong> · event #{selected.event_id}</p>

      <h4>Payment stages</h4>
      <table>
        <thead>
          <tr><th>#</th><th>Label</th><th class="num">Amount</th><th>Due</th><th>Status</th><th>Invoice</th><th>Receipt</th><th>Refund</th></tr>
        </thead>
        <tbody>
          {#each selected.stages as s}
            <tr class="status-{s.status}">
              <td>{s.sequence}</td>
              <td>{s.label}</td>
              <td class="num">{money(s.amount_cents, selected.currency)}</td>
              <td>{fmt(s.due_at)}</td>
              <td><span class="badge badge-{s.status}">{s.status}</span></td>
              <td>{s.invoice_number ?? '—'}</td>
              <td>{s.receipt_number ? `${s.receipt_number} @ ${fmt(s.paid_at)}` : '—'}</td>
              <td>{s.refund_number ? `${s.refund_number} (${s.refund_reason})` : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>

      {#if selected.line_items?.length}
        <h4>Reserved line items</h4>
        <ul>
          {#each selected.line_items as li}
            <li>
              <code>{li.sku}</code> {li.item_name} × {li.quantity}
              — reservation #{li.reservation_id}
              {#if li.reservation_status}<em>({li.reservation_status}{li.reservation_expires_at ? `, expires ${fmt(li.reservation_expires_at)}` : ''})</em>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </main>
</section>

<style>
  .wrap { display: grid; grid-template-columns: 320px 1fr; gap: 1rem; }
  aside { border-right: 1px solid #ddd; padding-right: 1rem; }
  .row  { display: flex; justify-content: space-between; align-items: baseline; }
  .plain { list-style: none; padding: 0; margin: 0.5rem 0 0; }
  .plain li { margin: 0.25rem 0; }
  .link { background: none; border: none; padding: 0.35rem 0.25rem; cursor: pointer; text-align: left; width: 100%; }
  .link.active { background: #eef2ff; border-radius: 4px; }
  .link small { display: block; color: #666; font-size: 0.8rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { padding: 0.35rem 0.5rem; border-bottom: 1px solid #eee; text-align: left; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .badge { padding: 0.1rem 0.45rem; border-radius: 999px; font-size: 0.75rem; }
  .badge-pending, .badge-invoiced { background: #e5e7eb; }
  .badge-paid     { background: #dcfce7; color: #166534; }
  .badge-refunded { background: #fee2e2; color: #b00020; }
  .badge-voided   { background: #fae8ff; color: #86198f; }
  .small { font-size: 0.8rem; }
  .error { color: #b00020; }
</style>
