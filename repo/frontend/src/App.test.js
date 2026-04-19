import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import App from './App.svelte';
import { clearSession } from './lib/session.js';

beforeEach(() => {
  localStorage.clear();
  clearSession();
});

describe('App — unauthenticated state', () => {
  it('renders the application title', () => {
    const { getByRole } = render(App);
    expect(getByRole('heading', { name: 'RoadshowOps Operations Suite', level: 1 })).toBeTruthy();
  });

  it('shows the "Sign in" heading', () => {
    const { getByRole } = render(App);
    expect(getByRole('heading', { name: 'Sign in', level: 2 })).toBeTruthy();
  });

  it('renders the sign-in submit button', () => {
    const { getByRole } = render(App);
    expect(getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('does not render sign-out button when unauthenticated', () => {
    const { queryByRole } = render(App);
    expect(queryByRole('button', { name: /sign out/i })).toBeNull();
  });
});
