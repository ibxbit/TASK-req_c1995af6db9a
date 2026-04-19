<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from '../api.js';

  let stock = [];
  let alerts = [];
  let error = '';
  let polling = true;
  let lastRefresh = null;
  let timer;

  async function refresh() {
    try {
      const [s, a] = await Promise.all([
        api('/inventory'),
        api('/inventory/alerts/low-stock')
      ]);
      stock = s;
      alerts = a;
      lastRefresh = new Date();
      error = '';
    } catch (e) {
      error = e.message || 'Failed to load inventory';
    }
  }

  onMount(() => {
    refresh();
    timer = setInterval(() => { if (polling) refresh(); }, 5000);
  });
  onDestroy(() => clearInterval(timer));

  $: lowKeys = new Set(alerts.map((a) => a.item_id));
</script>

<section>
  <header class="row">
    <h3>Inventory dashboard</h3>
    <div class="controls">
      <label><input type="checkbox" bind:checked={polling}/> Live (5s)</label>
      <button on:click={refresh}>Refresh now</button>
      {#if lastRefresh}<small>updated {lastRefresh.toLocaleTimeString()}</small>{/if}
    </div>
  </header>

  {#if error}<p class="error">{error}</p>{/if}

  {#if alerts.length}
    <div class="alerts">
      <strong>Low-stock alerts ({alerts.length})</strong>
      <ul>
        {#each alerts as a}
          <li><code>{a.sku}</code> — {a.name}: available <strong>{a.available_total}</strong> &lt; threshold {a.safety_threshold}</li>
        {/each}
      </ul>
    </div>
  {/if}

  <table>
    <thead>
      <tr>
        <th>SKU</th><th>Name</th><th>Warehouse</th><th>Location</th>
        <th class="num">On hand</th><th class="num">Reserved</th><th class="num">Available</th>
      </tr>
    </thead>
    <tbody>
      {#each stock as s (s.item_id + ':' + s.location_id)}
        <tr class:low={lowKeys.has(s.item_id)}>
          <td><code>{s.sku}</code></td>
          <td>{s.name}</td>
          <td>{s.warehouse_code}</td>
          <td>{s.location_code}</td>
          <td class="num">{s.on_hand}</td>
          <td class="num reserved">{s.reserved}</td>
          <td class="num available">{s.available}</td>
        </tr>
      {:else}
        <tr><td colspan="7"><em>No stock visible in your scope.</em></td></tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  .row      { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
  .controls { display: flex; gap: 0.75rem; align-items: center; font-size: 0.9rem; }
  .alerts   { background: #fef3c7; border: 1px solid #eab308; padding: 0.5rem 0.75rem; border-radius: 4px; margin: 0.5rem 0; }
  table     { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td    { padding: 0.4rem 0.5rem; border-bottom: 1px solid #eee; text-align: left; }
  .num      { text-align: right; font-variant-numeric: tabular-nums; }
  .reserved { color: #6b7280; }
  .available{ font-weight: 600; }
  tr.low    { background: #fee2e2; }
  .error    { color: #b00020; }
</style>
