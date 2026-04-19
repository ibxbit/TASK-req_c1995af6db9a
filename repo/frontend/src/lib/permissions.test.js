import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('PERMISSIONS constants', () => {
  it('exports expected permission codes', async () => {
    const { PERMISSIONS } = await import('./permissions.js');
    expect(PERMISSIONS.AUDIT_READ).toBe('audit.read');
    expect(PERMISSIONS.INVENTORY_READ).toBe('inventory.read');
    expect(PERMISSIONS.USER_MANAGE).toBe('user.manage');
    expect(PERMISSIONS.APPROVAL_APPROVE).toBe('approval.approve');
  });
});

describe('MENU_ITEMS', () => {
  it('contains 8 menu items', async () => {
    const { MENU_ITEMS } = await import('./permissions.js');
    expect(MENU_ITEMS).toHaveLength(8);
  });

  it('each item has key, label, permission', async () => {
    const { MENU_ITEMS } = await import('./permissions.js');
    for (const item of MENU_ITEMS) {
      expect(typeof item.key).toBe('string');
      expect(typeof item.label).toBe('string');
      expect(typeof item.permission).toBe('string');
    }
  });
});

describe('can derived store', () => {
  it('returns true for a permission the user holds', async () => {
    const { me } = await import('./session.js');
    const { can } = await import('./permissions.js');
    me.set({ id: 1, permissions: ['audit.read', 'inventory.read'] });
    const canFn = get(can);
    expect(canFn('audit.read')).toBe(true);
  });

  it('returns false for a permission the user lacks', async () => {
    const { me } = await import('./session.js');
    const { can } = await import('./permissions.js');
    me.set({ id: 1, permissions: ['inventory.read'] });
    const canFn = get(can);
    expect(canFn('audit.read')).toBe(false);
  });

  it('returns false for all permissions when me is null', async () => {
    const { me } = await import('./session.js');
    const { can } = await import('./permissions.js');
    me.set(null);
    const canFn = get(can);
    expect(canFn('audit.read')).toBe(false);
  });
});

describe('visibleMenu derived store', () => {
  it('returns only items the user can see', async () => {
    const { me } = await import('./session.js');
    const { visibleMenu } = await import('./permissions.js');
    me.set({ id: 1, permissions: ['menu.dashboard', 'menu.inventory'] });
    const items = get(visibleMenu);
    expect(items.map((i) => i.key)).toEqual(expect.arrayContaining(['dashboard', 'inventory']));
    expect(items.find((i) => i.key === 'audit')).toBeUndefined();
  });

  it('returns empty array when user has no menu permissions', async () => {
    const { me } = await import('./session.js');
    const { visibleMenu } = await import('./permissions.js');
    me.set({ id: 1, permissions: ['audit.read'] });
    const items = get(visibleMenu);
    expect(items).toHaveLength(0);
  });

  it('returns all menu items for admin with all menu permissions', async () => {
    const { me } = await import('./session.js');
    const { visibleMenu, MENU_ITEMS } = await import('./permissions.js');
    me.set({ id: 1, permissions: MENU_ITEMS.map((m) => m.permission) });
    const items = get(visibleMenu);
    expect(items).toHaveLength(MENU_ITEMS.length);
  });
});
