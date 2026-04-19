<script>
  import { onMount } from 'svelte';
  import { api } from '../api.js';
  import { can, PERMISSIONS } from '../permissions.js';
  import Guard from '../Guard.svelte';

  let tasks = [];
  let selected = null;
  let instance = null;
  let notes = '';
  let error = '';
  let busy = false;

  async function refresh() {
    try { tasks = await api('/workflows/tasks/mine'); error = ''; }
    catch (e) { error = e.message; }
  }

  async function open(t) {
    selected = t;
    notes = '';
    error = '';
    try { instance = await api(`/workflows/instances/${t.instance_id}`); }
    catch (e) { error = e.message; }
  }

  async function decide(action) {
    if (!selected) return;
    busy = true; error = '';
    try {
      const result = await api(`/workflows/tasks/${selected.id}/${action}`, {
        method: 'POST', body: { notes }
      });
      // Validation-driven rejection shows errors even on 2xx
      if (result?.validation_errors?.length) {
        error = 'Validation failed: ' + result.validation_errors.join('; ');
      }
      selected = null; instance = null; notes = '';
      await refresh();
    } catch (e) {
      const issues = e.data?.issues || e.data?.validation_errors;
      error = issues ? `${e.message}: ${issues.join('; ')}` : (e.message || 'Action failed');
    } finally { busy = false; }
  }

  const fmt = (ts) => ts ? new Date(ts).toLocaleString() : '—';
  onMount(refresh);
</script>

<section class="wrap">
  <aside>
    <h3>My tasks</h3>
    <button class="small" on:click={refresh}>Refresh</button>
    <ul class="plain">
      {#each tasks as t (t.id)}
        <li>
          <button class="link" class:active={selected?.id === t.id} on:click={() => open(t)}>
            <strong>{t.step_name}</strong>
            <small>
              {t.entity_type} #{t.entity_id}
              · due {fmt(t.due_at)}
              {#if t.is_overdue}<span class="overdue">OVERDUE</span>{/if}
            </small>
          </button>
        </li>
      {:else}
        <li><em>No open tasks assigned to your role.</em></li>
      {/each}
    </ul>
  </aside>

  <main>
    {#if error}<p class="error">{error}</p>{/if}
    {#if !selected}
      <p>Select a task to review and decide.</p>
    {:else if !instance}
      <p>Loading…</p>
    {:else}
      <h3>{instance.entity_type} #{instance.entity_id}</h3>
      <p>Definition: <code>{instance.definition_code}</code> · status <strong>{instance.status}</strong></p>
      {#if instance.summary}<p>{instance.summary}</p>{/if}

      <h4>Payload</h4>
      <pre class="payload">{JSON.stringify(instance.payload ?? {}, null, 2)}</pre>

      <h4>Task chain</h4>
      <ol>
        {#each instance.tasks as tk}
          <li class:active={tk.id === selected.id}>
            <strong>Step {tk.sequence}</strong>: {tk.step_name}
            — {tk.status}{tk.decision ? ` (${tk.decision})` : ''}
            {#if tk.is_overdue && tk.status === 'open'} <span class="overdue">OVERDUE</span>{/if}
            {#if tk.validation_errors?.length}
              <div class="issue">Validation: {tk.validation_errors.join('; ')}</div>
            {/if}
          </li>
        {/each}
      </ol>

      <label>
        Notes
        <textarea bind:value={notes} rows="2" placeholder="Optional decision notes"></textarea>
      </label>

      <div class="actions">
        <Guard permission={PERMISSIONS.APPROVAL_APPROVE} mode="disable">
          <button disabled={busy} on:click={() => decide('approve')}>Approve</button>
        </Guard>
        <Guard permission={PERMISSIONS.APPROVAL_REJECT} mode="disable">
          <button disabled={busy} on:click={() => decide('reject')}>Reject</button>
        </Guard>
        <Guard permission={PERMISSIONS.APPROVAL_REJECT} mode="disable">
          <button disabled={busy} on:click={() => decide('return')}>Return for changes</button>
        </Guard>
      </div>
    {/if}
  </main>
</section>

<style>
  .wrap { display: grid; grid-template-columns: 320px 1fr; gap: 1rem; }
  aside { border-right: 1px solid #ddd; padding-right: 1rem; }
  .plain { list-style: none; padding: 0; margin: 0.5rem 0 0; }
  .plain li { margin: 0.25rem 0; }
  .link { background: none; border: none; padding: 0.35rem 0.25rem; cursor: pointer; text-align: left; width: 100%; }
  .link.active { background: #eef2ff; border-radius: 4px; }
  .link small { display: block; color: #666; font-size: 0.8rem; }
  .overdue { color: #b91c1c; font-weight: 700; margin-left: 0.4rem; }
  .payload { background: #f4f4f5; padding: 0.5rem; border-radius: 4px; overflow: auto; max-height: 240px; font-size: 0.85rem; }
  ol li.active { font-weight: 600; }
  .issue { color: #b91c1c; font-size: 0.85rem; margin-top: 0.2rem; }
  label { display: block; margin: 0.5rem 0; }
  textarea { width: 100%; padding: 0.4rem; font: inherit; }
  .actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  .actions button { padding: 0.4rem 0.75rem; }
  .small { font-size: 0.8rem; }
  .error { color: #b00020; }
</style>
