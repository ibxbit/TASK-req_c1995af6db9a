<script>
  import { onMount } from 'svelte';
  import { api } from '../api.js';

  let events = [];
  let byAction = [];
  let retention = null;
  let error = '';
  let filters = { user_id: '', action: '', entity_type: '', from: '', to: '' };

  async function refresh() {
    error = '';
    try {
      const params = Object.entries(filters)
        .filter(([, v]) => v !== '' && v != null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
      const [ev, act, ret] = await Promise.all([
        api(`/audit/events${params ? '?' + params : ''}`),
        api('/audit/stats/by-action'),
        api('/audit/retention')
      ]);
      events = ev;
      byAction = act;
      retention = ret;
    } catch (e) {
      error = e.message || 'Failed to load audit data';
    }
  }

  const fmt = (ts) => (ts ? new Date(ts).toLocaleString() : '—');

  onMount(refresh);
</script>

<section>
  <header class="row">
    <h3>Audit log</h3>
    <button on:click={refresh}>Refresh</button>
  </header>

  {#if error}<p class="error">{error}</p>{/if}

  {#if retention}
    <p class="meta">
      Retention {retention.retention_years}y ·
      Oldest permission event {fmt(retention.oldest_permission_event)} ·
      stock ledger {fmt(retention.oldest_stock_ledger)} ·
      payment attempt {fmt(retention.oldest_payment_attempt)}
    </p>
  {/if}

  <form class="filters" on:submit|preventDefault={refresh}>
    <input placeholder="user_id" bind:value={filters.user_id} />
    <input placeholder="action prefix" bind:value={filters.action} />
    <input placeholder="entity_type" bind:value={filters.entity_type} />
    <input placeholder="from (ISO)" bind:value={filters.from} />
    <input placeholder="to (ISO)" bind:value={filters.to} />
    <button type="submit">Apply</button>
  </form>

  <h4>Action breakdown</h4>
  <table>
    <thead>
      <tr><th>Action</th><th>Total</th><th>Denied</th><th>Last</th></tr>
    </thead>
    <tbody>
      {#each byAction.slice(0, 20) as row (row.action)}
        <tr>
          <td><code>{row.action}</code></td>
          <td>{row.total}</td>
          <td>{row.denied}</td>
          <td>{fmt(row.last_event)}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <h4>Recent events</h4>
  <table>
    <thead>
      <tr>
        <th>Time</th><th>User</th><th>Action</th><th>Entity</th>
        <th>Granted</th><th>Workstation</th><th>Reason</th>
      </tr>
    </thead>
    <tbody>
      {#each events as e (e.id)}
        <tr class:denied={!e.granted}>
          <td>{fmt(e.occurred_at)}</td>
          <td>{e.username || e.user_id || '—'}</td>
          <td><code>{e.action || e.permission_code || ''}</code></td>
          <td>{e.entity_type || '—'} {e.entity_id ? '#' + e.entity_id : ''}</td>
          <td>{e.granted ? '✓' : '✗'}</td>
          <td>{e.workstation || '—'}</td>
          <td>{e.reason || ''}</td>
        </tr>
      {:else}
        <tr><td colspan="7"><em>No audit events matched.</em></td></tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  .row { display: flex; justify-content: space-between; align-items: baseline; }
  .meta { color: #666; font-size: 0.85rem; }
  .filters { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 0.5rem 0; }
  .filters input { padding: 0.3rem; font: inherit; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 1rem; }
  th, td { text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid #eee; }
  tr.denied { color: #b91c1c; }
  .error { color: #b00020; }
</style>
