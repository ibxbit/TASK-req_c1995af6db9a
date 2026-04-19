<script>
  import { onMount } from 'svelte';
  import { api } from '../api.js';
  import Guard from '../Guard.svelte';
  import { can, PERMISSIONS } from '../permissions.js';

  let users = [];
  let error = '';
  let busy = false;

  let form = { username: '', email: '', full_name: '', password: '', role_codes: '', city_codes: '' };

  async function refresh() {
    error = '';
    try {
      users = await api('/admin/users');
    } catch (e) {
      error = e.message || 'Failed to load users';
    }
  }

  async function create() {
    if (busy) return;
    busy = true; error = '';
    try {
      const body = {
        username: form.username.trim(),
        email: form.email.trim(),
        full_name: form.full_name.trim(),
        password: form.password,
        role_codes: form.role_codes.split(',').map((s) => s.trim()).filter(Boolean),
        city_codes: form.city_codes.split(',').map((s) => s.trim()).filter(Boolean)
      };
      await api('/admin/users', { method: 'POST', body });
      form = { username: '', email: '', full_name: '', password: '', role_codes: '', city_codes: '' };
      await refresh();
    } catch (e) {
      error = e.message || 'Create failed';
    } finally { busy = false; }
  }

  async function unlock(userId) {
    busy = true; error = '';
    try {
      await api(`/admin/users/${userId}/unlock`, { method: 'POST' });
      await refresh();
    } catch (e) {
      error = e.message || 'Unlock failed';
    } finally { busy = false; }
  }

  onMount(() => { if ($can(PERMISSIONS.USER_MANAGE)) refresh(); });
</script>

<section>
  <header class="row">
    <h3>Users &amp; roles</h3>
    <button on:click={refresh} disabled={busy}>Refresh</button>
  </header>

  {#if !$can(PERMISSIONS.USER_MANAGE)}
    <p><em>You don't have permission to manage users.</em></p>
  {:else}
    {#if error}<p class="error">{error}</p>{/if}

    <table>
      <thead>
        <tr><th>ID</th><th>Username</th><th>Name</th><th>Email</th><th>Roles</th><th>Active</th><th></th></tr>
      </thead>
      <tbody>
        {#each users as u (u.id)}
          <tr>
            <td>{u.id}</td>
            <td>{u.username}</td>
            <td>{u.full_name}</td>
            <td>{u.email}</td>
            <td>{(u.roles || []).join(', ')}</td>
            <td>{u.is_active ? '✓' : '—'}</td>
            <td>
              <Guard permission={PERMISSIONS.USER_MANAGE} mode="disable">
                <button class="small" on:click={() => unlock(u.id)} disabled={busy}>Unlock</button>
              </Guard>
            </td>
          </tr>
        {:else}
          <tr><td colspan="7"><em>No users.</em></td></tr>
        {/each}
      </tbody>
    </table>

    <h4>Create user</h4>
    <form on:submit|preventDefault={create} class="create">
      <input placeholder="Username"  bind:value={form.username}  required />
      <input placeholder="Email"     bind:value={form.email}     required type="email" />
      <input placeholder="Full name" bind:value={form.full_name} required />
      <input placeholder="Password"  bind:value={form.password}  required type="password" />
      <input placeholder="Role codes (comma-separated, e.g. FINANCE,APPROVER)"
             bind:value={form.role_codes} />
      <input placeholder="City codes (comma-separated)" bind:value={form.city_codes} />
      <button type="submit" disabled={busy}>Create</button>
    </form>
  {/if}
</section>

<style>
  .row { display: flex; justify-content: space-between; align-items: baseline; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 0.5rem 0 1rem; }
  th, td { text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid #eee; }
  .create { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; max-width: 640px; }
  .create input, .create button { padding: 0.4rem; font: inherit; }
  .create button[type="submit"] { grid-column: 1 / -1; }
  .small { font-size: 0.8rem; padding: 0.2rem 0.5rem; }
  .error { color: #b00020; }
</style>
