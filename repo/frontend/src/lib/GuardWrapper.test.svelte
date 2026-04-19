<script>
  import Guard from './Guard.svelte';
  export let permission;
  export let mode = 'hide';
</script>
<Guard {permission} {mode}>
  <span>Protected Content</span>
</Guard>
