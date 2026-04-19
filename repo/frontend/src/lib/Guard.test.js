import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import GuardWrapper from './GuardWrapper.test.svelte';
import { me, clearSession } from './session.js';

beforeEach(() => {
  localStorage.clear();
  clearSession();
});

describe('Guard — hide mode (default)', () => {
  it('renders slot when user holds the required permission', () => {
    me.set({ id: 1, permissions: ['audit.read'] });
    const { getByText } = render(GuardWrapper, { props: { permission: 'audit.read' } });
    expect(getByText('Protected Content')).toBeTruthy();
  });

  it('does not render slot when user lacks the permission', () => {
    me.set({ id: 1, permissions: ['inventory.read'] });
    const { queryByText } = render(GuardWrapper, { props: { permission: 'audit.read' } });
    expect(queryByText('Protected Content')).toBeNull();
  });

  it('does not render slot when unauthenticated (me is null)', () => {
    const { queryByText } = render(GuardWrapper, { props: { permission: 'audit.read' } });
    expect(queryByText('Protected Content')).toBeNull();
  });
});

describe('Guard — disable mode', () => {
  it('renders .guard-disabled wrapper with aria-disabled when permission is absent', () => {
    me.set({ id: 1, permissions: [] });
    const { container } = render(GuardWrapper, { props: { permission: 'audit.read', mode: 'disable' } });
    const wrapper = container.querySelector('.guard-disabled');
    expect(wrapper).not.toBeNull();
    expect(wrapper.getAttribute('aria-disabled')).toBe('true');
  });

  it('renders slot without .guard-disabled when permission is present', () => {
    me.set({ id: 1, permissions: ['audit.read'] });
    const { getByText, container } = render(GuardWrapper, { props: { permission: 'audit.read', mode: 'disable' } });
    expect(getByText('Protected Content')).toBeTruthy();
    expect(container.querySelector('.guard-disabled')).toBeNull();
  });
});
