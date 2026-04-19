import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import DashboardWorkspace from './DashboardWorkspace.svelte';
import { me, clearSession } from './session.js';

const FAKE_ME = {
  fullName: 'Jane Recruiter',
  roles: [{ name: 'RECRUITER' }],
  assignedCities: [{ name: 'New York' }, { name: 'Chicago' }],
  permissions: ['menu.dashboard', 'menu.recruiting', 'candidate.read']
};

beforeEach(() => {
  localStorage.clear();
  clearSession();
  me.set(FAKE_ME);
});

describe('DashboardWorkspace', () => {
  it("renders a welcome heading with the user's full name", () => {
    const { getByText } = render(DashboardWorkspace);
    expect(getByText(/Jane Recruiter/)).toBeTruthy();
  });

  it('shows the user role name', () => {
    const { getByText } = render(DashboardWorkspace);
    expect(getByText(/RECRUITER/)).toBeTruthy();
  });

  it('lists at least one assigned city', () => {
    const { getByText } = render(DashboardWorkspace);
    expect(getByText(/New York/)).toBeTruthy();
  });

  it('lists accessible menu areas the user holds permissions for', () => {
    const { getByText } = render(DashboardWorkspace);
    // menu.dashboard → "Dashboard" item rendered
    expect(getByText(/Dashboard/)).toBeTruthy();
  });
});
