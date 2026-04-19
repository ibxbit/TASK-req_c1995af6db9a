<script>
  import { can } from './permissions.js';

  /** Required permission code. */
  export let permission;
  /** If true, render disabled instead of hiding. */
  export let mode = 'hide'; // 'hide' | 'disable'
</script>

{#if $can(permission)}
  <slot />
{:else if mode === 'disable'}
  <span class="guard-disabled" aria-disabled="true" title="Permission required: {permission}">
    <slot />
  </span>
{/if}

<style>
  .guard-disabled {
    opacity: 0.45;
    pointer-events: none;
    cursor: not-allowed;
  }
</style>
