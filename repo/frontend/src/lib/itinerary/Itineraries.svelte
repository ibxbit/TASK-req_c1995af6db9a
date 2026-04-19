<script>
  import { onMount } from 'svelte';
  import { api } from '../api.js';

  let itineraries = [];
  let selectedId = null;
  let current = null;          // { id, name, events: [...] }
  let versions = [];
  let issues = [];
  let error = '';
  let dragFromIndex = null;
  let pendingOrder = null;     // event ids array after local reorder

  async function refreshList() {
    itineraries = await api('/itineraries');
  }

  async function open(id) {
    selectedId = id;
    current = await api(`/itineraries/${id}`);
    pendingOrder = null;
    await Promise.all([refreshVersions(), validate()]);
  }

  async function refreshVersions() {
    versions = await api(`/itineraries/${selectedId}/versions`);
  }

  async function validate() {
    const r = await api(`/itineraries/${selectedId}/validate`);
    issues = r.issues;
  }

  function onDragStart(i) { dragFromIndex = i; }
  function onDragOver(e)  { e.preventDefault(); }
  function onDrop(i) {
    if (dragFromIndex === null || dragFromIndex === i) return;
    const list = [...current.events];
    const [moved] = list.splice(dragFromIndex, 1);
    list.splice(i, 0, moved);
    current = { ...current, events: list };
    pendingOrder = list.map((e) => e.id);
    dragFromIndex = null;
  }

  async function saveReorder() {
    error = '';
    try {
      current = await api(`/itineraries/${selectedId}/reorder`, {
        method: 'POST',
        body: { order: pendingOrder }
      });
      pendingOrder = null;
      await Promise.all([refreshVersions(), validate()]);
    } catch (e) {
      error = formatError(e);
      await open(selectedId);
    }
  }

  async function restore(n) {
    error = '';
    if (!confirm(`Restore itinerary to version ${n}? A new version will be recorded.`)) return;
    try {
      current = await api(`/itineraries/${selectedId}/versions/${n}/restore`, { method: 'POST' });
      await Promise.all([refreshVersions(), validate()]);
    } catch (e) {
      error = formatError(e);
    }
  }

  function formatError(e) {
    if (e?.data?.issues) {
      return `${e.message}: ` + e.data.issues.map((i) => i.message).join('; ');
    }
    return e?.message || String(e);
  }

  function fmt(ts) { return new Date(ts).toLocaleString(); }

  onMount(refreshList);
</script>

<section class="wrap">
  <aside>
    <h3>Itineraries</h3>
    <ul class="plain">
      {#each itineraries as it}
        <li>
          <button class="link" class:active={it.id === selectedId} on:click={() => open(it.id)}>
            #{it.id} — {it.name} ({it.itinerary_date})
          </button>
        </li>
      {:else}
        <li><em>No itineraries in your scope.</em></li>
      {/each}
    </ul>
  </aside>

  <main>
    {#if current}
      <header class="row">
        <h3>{current.name} <small>(v{current.current_version})</small></h3>
        {#if pendingOrder}
          <button on:click={saveReorder}>Save new order</button>
        {/if}
      </header>

      {#if error}<p class="error">{error}</p>{/if}

      <h4>Events — drag to reorder</h4>
      <ol class="events">
        {#each current.events as e, i (e.id)}
          <li
            draggable="true"
            on:dragstart={() => onDragStart(i)}
            on:dragover={onDragOver}
            on:drop={() => onDrop(i)}
          >
            <span class="handle" aria-hidden="true">⋮⋮</span>
            <strong>{e.title}</strong>
            <span>{fmt(e.start_at)} → {fmt(e.end_at)}</span>
            {#if e.venue_id}<span class="meta">venue #{e.venue_id}</span>{/if}
          </li>
        {:else}
          <li><em>No events yet.</em></li>
        {/each}
      </ol>

      {#if issues.length}
        <h4>Conflicts</h4>
        <ul class="issues">
          {#each issues as is}
            <li class="issue issue-{is.type}">{is.message}</li>
          {/each}
        </ul>
      {:else}
        <p class="ok">No conflicts.</p>
      {/if}

      <h4>Version history</h4>
      <ul class="plain">
        {#each versions as v}
          <li>
            v{v.version_number} — {fmt(v.created_at)} by {v.changed_by_username ?? v.changed_by}
            {#if v.change_summary}— <em>{v.change_summary}</em>{/if}
            {#if v.version_number !== current.current_version}
              <button class="small" on:click={() => restore(v.version_number)}>Restore</button>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p>Select an itinerary to view and edit.</p>
    {/if}
  </main>
</section>

<style>
  .wrap { display: grid; grid-template-columns: 260px 1fr; gap: 1rem; }
  aside { border-right: 1px solid #ddd; padding-right: 1rem; }
  .plain { list-style: none; padding: 0; margin: 0; }
  .plain li { margin: 0.25rem 0; }
  .link { background: none; border: none; padding: 0.25rem 0; cursor: pointer; text-align: left; }
  .link.active { font-weight: 600; }
  .row { display: flex; justify-content: space-between; align-items: center; }
  .events { padding-left: 1rem; }
  .events li {
    display: flex; gap: 0.5rem; align-items: center;
    padding: 0.4rem 0.5rem; margin: 0.25rem 0;
    border: 1px solid #ccc; border-radius: 4px; background: #fafafa; cursor: grab;
  }
  .handle { color: #888; }
  .meta  { color: #666; font-size: 0.85rem; }
  .issues { padding-left: 1rem; }
  .issue { padding: 0.25rem 0.5rem; border-radius: 4px; margin: 0.25rem 0; }
  .issue-overlap            { background: #fee2e2; }
  .issue-buffer             { background: #fef3c7; }
  .issue-drive_time_missing { background: #e0e7ff; }
  .ok    { color: #166534; }
  .error { color: #b00020; }
  .small { padding: 0.15rem 0.5rem; font-size: 0.8rem; margin-left: 0.5rem; }
</style>
