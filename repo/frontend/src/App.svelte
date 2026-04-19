<script>
  import { onMount } from 'svelte';
  import { api } from './lib/api.js';
  import { token, me, isAuthed, setSession, clearSession } from './lib/session.js';
  import { visibleMenu, can, PERMISSIONS } from './lib/permissions.js';
  import Guard from './lib/Guard.svelte';
  import Itineraries from './lib/itinerary/Itineraries.svelte';
  import InventoryDashboard from './lib/inventory/InventoryDashboard.svelte';
  import OrdersView from './lib/orders/OrdersView.svelte';
  import TaskInbox from './lib/workflows/TaskInbox.svelte';
  import RoadshowWorkspace from './lib/roadshow/RoadshowWorkspace.svelte';
  import AuditWorkspace from './lib/audit/AuditWorkspace.svelte';
  import AdminWorkspace from './lib/admin/AdminWorkspace.svelte';
  import DashboardWorkspace from './lib/DashboardWorkspace.svelte';

  let username = '';
  let password = '';
  let error = '';
  let activeMenu = 'dashboard';

  onMount(async () => {
    if ($token) {
      try {
        const profile = await api('/auth/me');
        me.set(profile);
      } catch {
        clearSession();
      }
    }
  });

  async function login() {
    error = '';
    try {
      const { token: t } = await api('/auth/login', {
        method: 'POST',
        body: { username, password }
      });
      token.set(t);
      const profile = await api('/auth/me');
      me.set(profile);
      password = '';
    } catch (e) {
      error = e.message || 'Login failed';
    }
  }

  function logout() {
    clearSession();
    activeMenu = 'dashboard';
  }
</script>

<main>
  <header>
    <h1>RoadshowOps Operations Suite</h1>
    {#if $isAuthed}
      <div class="user-bar">
        <span>{$me.fullName} ({$me.roles.map((r) => r.name).join(', ')})</span>
        <button on:click={logout}>Sign out</button>
      </div>
    {/if}
  </header>

  {#if !$isAuthed}
    <section class="login">
      <h2>Sign in</h2>
      <form on:submit|preventDefault={login}>
        <input bind:value={username} placeholder="Username" autocomplete="username" required />
        <input bind:value={password} type="password" placeholder="Password"
               autocomplete="current-password" required />
        <button type="submit">Sign in</button>
      </form>
      {#if error}<p class="error">{error}</p>{/if}
    </section>
  {:else}
    <nav>
      {#each $visibleMenu as item}
        <button class:active={activeMenu === item.key} on:click={() => (activeMenu = item.key)}>
          {item.label}
        </button>
      {/each}
    </nav>

    <section class="content">
      <h2>{activeMenu}</h2>

      {#if activeMenu === 'dashboard' && $can(PERMISSIONS.MENU_DASHBOARD)}
        <DashboardWorkspace />
      {:else if activeMenu === 'recruiting' && $can(PERMISSIONS.CANDIDATE_READ)}
        <Itineraries />
      {:else if activeMenu === 'roadshow' && $can(PERMISSIONS.MENU_ROADSHOW)}
        <RoadshowWorkspace />
      {:else if activeMenu === 'inventory' && $can(PERMISSIONS.INVENTORY_READ)}
        <InventoryDashboard />
      {:else if activeMenu === 'finance' && $can(PERMISSIONS.FINANCE_READ)}
        <OrdersView />
      {:else if activeMenu === 'approvals' && $can(PERMISSIONS.MENU_APPROVALS)}
        <TaskInbox />
      {:else if activeMenu === 'audit' && $can(PERMISSIONS.AUDIT_READ)}
        <AuditWorkspace />
      {:else if activeMenu === 'admin' && $can(PERMISSIONS.MENU_ADMIN)}
        <AdminWorkspace />
      {:else}
        <p><em>This area is not available to your role.</em></p>
      {/if}
    </section>
  {/if}
</main>

<style>
  main { font-family: system-ui, sans-serif; max-width: 1024px; margin: 0 auto; padding: 1.5rem; }
  header { display: flex; justify-content: space-between; align-items: baseline; }
  .user-bar { display: flex; gap: 1rem; align-items: center; }
  nav { display: flex; gap: 0.5rem; border-bottom: 1px solid #ccc; margin: 1rem 0; padding-bottom: 0.5rem; }
  nav button { padding: 0.5rem 0.75rem; border: 1px solid transparent; background: transparent; cursor: pointer; }
  nav button.active { border-color: #888; border-radius: 4px; background: #eee; }
  .login { max-width: 320px; margin: 2rem auto; }
  .login form { display: flex; flex-direction: column; gap: 0.5rem; }
  .login input, .login button { padding: 0.5rem; font: inherit; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.5rem 0 1rem; }
  .error { color: #b00020; }
  .perms { display: block; padding: 0.5rem; background: #f4f4f4; border-radius: 4px; font-size: 0.85rem; word-break: break-word; }
</style>
