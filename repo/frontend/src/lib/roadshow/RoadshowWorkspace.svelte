<script>
  import { onMount } from 'svelte';
  import { api } from '../api.js';
  import { can, PERMISSIONS } from '../permissions.js';

  let events = [];
  let selected = null;
  let orders = [];
  let error = '';
  let loading = false;

  async function refresh() {
    loading = true;
    error = '';
    try {
      events = await api('/events');
    } catch (e) {
      error = e.message || 'Failed to load events';
    } finally {
      loading = false;
    }
  }

  async function open(ev) {
    selected = ev;
    orders = [];
    if (!$can(PERMISSIONS.ORDER_READ)) return;
    try {
      const all = await api('/orders');
      orders = all.filter((o) => Number(o.event_id) === Number(ev.id));
    } catch (e) {
      error = e.message || 'Failed to load orders';
    }
  }

  const fmt = (ts) => (ts ? new Date(ts).toLocaleString() : '—');

  onMount(refresh);
</script>

<section class="wrap">
  <aside>
    <header class="row">
      <h3>Roadshow events</h3>
      <button class="small" on:click={refresh} disabled={loading}>Refresh</button>
    </header>
    {#if error}<p class="error">{error}</p>{/if}
    <ul class="plain">
      {#each events as ev (ev.id)}
        <li>
          <button class="link" class:active={selected?.id === ev.id} on:click={() => open(ev)}>
            <strong>{ev.name}</strong>
            <small>
              {fmt(ev.starts_at)}
              · city {ev.city_id}
              · {ev.status}
              · hc {ev.current_headcount}/{ev.min_headcount}
            </small>
          </button>
        </li>
      {:else}
        <li><em>No events visible in your city scope.</em></li>
      {/each}
    </ul>
  </aside>

  <main>
    {#if !selected}
      <p>Select an event to see linked orders.</p>
    {:else}
      <h3>{selected.name}</h3>
      <p>
        <strong>Starts:</strong> {fmt(selected.starts_at)}
        · <strong>Cutoff:</strong> {fmt(selected.headcount_cutoff_at)}
        · <strong>Status:</strong> {selected.status}
      </p>

      <h4>Orders ({orders.length})</h4>
      {#if !$can(PERMISSIONS.ORDER_READ)}
        <p><em>You don't have permission to view orders on this event.</em></p>
      {:else}
        <table>
          <thead>
            <tr>
              <th>Order #</th><th>Customer</th><th>Total</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {#each orders as o (o.id)}
              <tr>
                <td>{o.order_number}</td>
                <td>{o.customer_name}</td>
                <td>{(Number(o.total_amount_cents) / 100).toFixed(2)} {o.currency}</td>
                <td>{o.status}</td>
              </tr>
            {:else}
              <tr><td colspan="4"><em>No orders on this event.</em></td></tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {/if}
  </main>
</section>

<style>
  .wrap { display: grid; grid-template-columns: 320px 1fr; gap: 1rem; }
  aside { border-right: 1px solid #ddd; padding-right: 1rem; }
  .row { display: flex; justify-content: space-between; align-items: baseline; }
  .plain { list-style: none; padding: 0; margin: 0.5rem 0 0; }
  .plain li { margin: 0.25rem 0; }
  .link { background: none; border: none; padding: 0.35rem 0.25rem; cursor: pointer; text-align: left; width: 100%; }
  .link.active { background: #eef2ff; border-radius: 4px; }
  .link small { display: block; color: #666; font-size: 0.8rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid #eee; }
  .small { font-size: 0.8rem; }
  .error { color: #b00020; }
</style>
