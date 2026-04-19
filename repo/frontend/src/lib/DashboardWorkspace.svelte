<script>
  import { me } from './session.js';
  import { PERMISSIONS, MENU_ITEMS } from './permissions.js';
</script>

<section>
  <h3>Welcome, {$me.fullName}</h3>
  <p>Roles: <strong>{$me.roles.map((r) => r.name).join(', ')}</strong></p>
  <p>Assigned cities:
    {$me.assignedCities.length
      ? $me.assignedCities.map((c) => c.name).join(', ')
      : '(none)'}
  </p>

  <h4>Your accessible areas</h4>
  <ul>
    {#each MENU_ITEMS as m (m.key)}
      {#if $me.permissions.includes(m.permission)}
        <li><strong>{m.label}</strong> — <code>{m.permission}</code></li>
      {/if}
    {/each}
  </ul>
</section>

<style>
  ul { list-style: disc; padding-left: 1.5rem; }
</style>
