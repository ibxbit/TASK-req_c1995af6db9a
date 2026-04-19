import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import Itineraries from './Itineraries.svelte';
import { clearSession } from '../session.js';
import { api } from '../api.js';

vi.mock('../api.js', () => ({ api: vi.fn() }));

const ITINERARY_LIST = [
  { id: 1, name: 'Spring Tour', itinerary_date: '2025-04-01' },
  { id: 2, name: 'Fall Tour',   itinerary_date: '2025-10-01' },
];

const ITINERARY_DETAIL = {
  id: 1, name: 'Spring Tour', itinerary_date: '2025-04-01', current_version: 3,
  events: [
    { id: 10, title: 'Kickoff Dinner', start_at: '2025-04-01T18:00:00Z', end_at: '2025-04-01T21:00:00Z', venue_id: 5 },
    { id: 11, title: 'Morning Briefing', start_at: '2025-04-02T09:00:00Z', end_at: '2025-04-02T10:00:00Z', venue_id: null },
  ],
};

const VERSIONS = [
  { version_number: 3, created_at: '2025-03-20T10:00:00Z', changed_by: 1, changed_by_username: 'alice', change_summary: 'Added venue' },
  { version_number: 2, created_at: '2025-03-15T09:00:00Z', changed_by: 1, changed_by_username: 'alice', change_summary: 'Reordered' },
];

const VALIDATE_OK  = { issues: [] };
const VALIDATE_ERR = { issues: [{ type: 'overlap', message: 'Events overlap at 9:00 AM' }] };

function mockOpenItinerary(detail = ITINERARY_DETAIL, validate = VALIDATE_OK) {
  api
    .mockResolvedValueOnce(ITINERARY_LIST)  // initial list
    .mockResolvedValueOnce(detail)          // detail on click
    .mockResolvedValueOnce(VERSIONS)        // versions
    .mockResolvedValueOnce(validate);       // validate
}

beforeEach(() => {
  localStorage.clear();
  clearSession();
  vi.clearAllMocks();
});

// ── layout ────────────────────────────────────────────────────────────────────
describe('Itineraries — layout', () => {
  it('renders "Itineraries" heading', () => {
    api.mockResolvedValue([]);
    const { getByText } = render(Itineraries);
    expect(getByText('Itineraries')).toBeTruthy();
  });

  it('shows placeholder text when no itinerary is selected', () => {
    api.mockResolvedValue([]);
    const { getByText } = render(Itineraries);
    expect(getByText(/select an itinerary/i)).toBeTruthy();
  });
});

// ── itinerary list ────────────────────────────────────────────────────────────
describe('Itineraries — list', () => {
  it('shows empty state when no itineraries', async () => {
    api.mockResolvedValue([]);
    const { findByText } = render(Itineraries);
    await findByText(/no itineraries in your scope/i);
  });

  it('renders itinerary names from API', async () => {
    api.mockResolvedValue(ITINERARY_LIST);
    const { findByText } = render(Itineraries);
    await findByText(/spring tour/i);
    await findByText(/fall tour/i);
  });

  it('renders itinerary date alongside name', async () => {
    api.mockResolvedValue(ITINERARY_LIST);
    const { findByText } = render(Itineraries);
    await findByText(/2025-04-01/);
  });
});

// ── itinerary detail ──────────────────────────────────────────────────────────
describe('Itineraries — detail', () => {
  it('loads detail, versions and validation on click', async () => {
    mockOpenItinerary();
    const { findByText } = render(Itineraries);
    await findByText(/spring tour/i);
    await fireEvent.click(document.querySelector('button.link'));
    await findByText('Spring Tour');
    await findByText('Kickoff Dinner');
  });

  it('shows current version number in heading', async () => {
    mockOpenItinerary();
    const { findByText } = render(Itineraries);
    await findByText(/spring tour/i);
    await fireEvent.click(document.querySelector('button.link'));
    await findByText('(v3)');
  });

  it('renders event titles in the events list', async () => {
    mockOpenItinerary();
    const { findByText } = render(Itineraries);
    await findByText(/spring tour/i);
    await fireEvent.click(document.querySelector('button.link'));
    await findByText('Kickoff Dinner');
    await findByText('Morning Briefing');
  });

  it('shows "No conflicts" when validation passes', async () => {
    mockOpenItinerary(ITINERARY_DETAIL, VALIDATE_OK);
    const { findByText } = render(Itineraries);
    await findByText(/spring tour/i);
    await fireEvent.click(document.querySelector('button.link'));
    await findByText(/no conflicts/i);
  });

  it('shows conflict message when validation fails', async () => {
    mockOpenItinerary(ITINERARY_DETAIL, VALIDATE_ERR);
    const { findByText } = render(Itineraries);
    await findByText(/spring tour/i);
    await fireEvent.click(document.querySelector('button.link'));
    await findByText(/conflicts/i);
    await findByText(/events overlap/i);
  });

  it('renders version history section heading', async () => {
    mockOpenItinerary();
    const { findByText } = render(Itineraries);
    await findByText(/spring tour/i);
    await fireEvent.click(document.querySelector('button.link'));
    await findByText(/version history/i);
  });

  it('renders version entries with username', async () => {
    mockOpenItinerary();
    const { findAllByText, findByText } = render(Itineraries);
    await findByText(/spring tour/i);
    await fireEvent.click(document.querySelector('button.link'));
    const aliceEls = await findAllByText(/alice/);
    expect(aliceEls.length).toBeGreaterThan(0);
    await findByText(/added venue/i);
  });

  it('renders Restore buttons for non-current versions', async () => {
    mockOpenItinerary();
    const { findAllByRole } = render(Itineraries);
    await findAllByRole('button', { name: /spring tour/i }).catch(() => null);
    await fireEvent.click(document.querySelector('button.link'));
    await waitFor(() => {
      const restoreBtns = document.querySelectorAll('button.small');
      expect(restoreBtns.length).toBeGreaterThan(0);
    });
  });
});

// ── reorder ───────────────────────────────────────────────────────────────────
describe('Itineraries — reorder', () => {
  it('shows "Save new order" button after drag reorder', async () => {
    mockOpenItinerary();
    const { findByText } = render(Itineraries);
    await findByText(/spring tour/i);
    await fireEvent.click(document.querySelector('button.link'));
    await findByText('Kickoff Dinner');

    const items = document.querySelectorAll('ol.events li');
    if (items.length >= 2) {
      await fireEvent.dragStart(items[0]);
      await fireEvent.dragOver(items[1]);
      await fireEvent.drop(items[1]);
      await findByText(/save new order/i);
    }
  });
});

// ── restore ───────────────────────────────────────────────────────────────────
describe('Itineraries — restore', () => {
  it('calls restore endpoint when Restore is confirmed', async () => {
    vi.stubGlobal('confirm', () => true);
    mockOpenItinerary();
    // After restore: detail + versions + validate again
    api
      .mockResolvedValueOnce(ITINERARY_DETAIL)  // restore response
      .mockResolvedValueOnce(VERSIONS)           // versions refresh
      .mockResolvedValueOnce(VALIDATE_OK);       // validate refresh

    const { findByText } = render(Itineraries);
    await findByText(/spring tour/i);
    await fireEvent.click(document.querySelector('button.link'));
    await findByText(/version history/i);

    await waitFor(() => {
      const restoreBtn = document.querySelector('button.small');
      expect(restoreBtn).not.toBeNull();
    });
    const restoreBtn = document.querySelector('button.small');
    await fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(api.mock.calls.some(([url, opts]) =>
        url.includes('/restore') && opts?.method === 'POST'
      )).toBe(true);
    });
    vi.unstubAllGlobals();
  });

  it('does not call restore when confirm is cancelled', async () => {
    vi.stubGlobal('confirm', () => false);
    mockOpenItinerary();

    const { findByText } = render(Itineraries);
    await findByText(/spring tour/i);
    await fireEvent.click(document.querySelector('button.link'));
    await findByText(/version history/i);

    await waitFor(() => {
      const restoreBtn = document.querySelector('button.small');
      expect(restoreBtn).not.toBeNull();
    });
    const callsBefore = api.mock.calls.length;
    const restoreBtn = document.querySelector('button.small');
    await fireEvent.click(restoreBtn);

    await waitFor(() => expect(api.mock.calls.length).toBe(callsBefore));
    vi.unstubAllGlobals();
  });
});
