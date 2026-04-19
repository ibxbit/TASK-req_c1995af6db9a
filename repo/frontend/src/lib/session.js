import { writable, derived } from 'svelte/store';

const TOKEN_KEY = 'roadshowops.token';

export const token = writable(localStorage.getItem(TOKEN_KEY));
export const me = writable(null);

token.subscribe((t) => {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
});

export const getToken = () => localStorage.getItem(TOKEN_KEY);

export function setSession(tokenValue, meValue) {
  token.set(tokenValue);
  me.set(meValue);
}

export function clearSession() {
  token.set(null);
  me.set(null);
}

export const permissions = derived(me, ($me) => new Set($me?.permissions || []));
export const isAuthed    = derived(me, ($me) => !!$me);
