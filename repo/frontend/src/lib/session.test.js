import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

const TOKEN_KEY = 'roadshowops.token';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('session stores', () => {
  it('token store initialises from localStorage', async () => {
    localStorage.setItem(TOKEN_KEY, 'stored-token');
    const { token } = await import('./session.js');
    expect(get(token)).toBe('stored-token');
  });

  it('token store initialises to null when localStorage empty', async () => {
    const { token } = await import('./session.js');
    expect(get(token)).toBeNull();
  });

  it('setSession stores token and me', async () => {
    const { token, me, setSession } = await import('./session.js');
    const fakeMe = { id: 1, username: 'admin', permissions: ['audit.read'] };
    setSession('tok-abc', fakeMe);
    expect(get(token)).toBe('tok-abc');
    expect(get(me)).toEqual(fakeMe);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-abc');
  });

  it('clearSession removes token and me', async () => {
    const { token, me, setSession, clearSession } = await import('./session.js');
    setSession('tok-xyz', { id: 2 });
    clearSession();
    expect(get(token)).toBeNull();
    expect(get(me)).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('permissions derived store returns set of permission codes', async () => {
    const { me, permissions, setSession } = await import('./session.js');
    setSession('t', { id: 1, permissions: ['audit.read', 'inventory.read'] });
    const perms = get(permissions);
    expect(perms.has('audit.read')).toBe(true);
    expect(perms.has('inventory.read')).toBe(true);
    expect(perms.has('user.manage')).toBe(false);
  });

  it('permissions derived store is empty Set when me is null', async () => {
    const { me, permissions } = await import('./session.js');
    me.set(null);
    expect(get(permissions).size).toBe(0);
  });

  it('isAuthed is true when me is set', async () => {
    const { me, isAuthed } = await import('./session.js');
    me.set({ id: 1 });
    expect(get(isAuthed)).toBe(true);
  });

  it('isAuthed is false when me is null', async () => {
    const { me, isAuthed } = await import('./session.js');
    me.set(null);
    expect(get(isAuthed)).toBe(false);
  });

  it('getToken returns current localStorage value', async () => {
    const { setSession, getToken } = await import('./session.js');
    setSession('tok-get', { id: 1 });
    expect(getToken()).toBe('tok-get');
  });
});
