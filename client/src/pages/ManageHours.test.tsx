import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreScheduleResponse, User } from '../types/api';

const api = vi.hoisted(() => ({
  fetchStoreHours: vi.fn(),
  saveStoreHours: vi.fn(),
  createScheduleException: vi.fn(),
  deleteScheduleException: vi.fn(),
}));
vi.mock('../services/stores', () => api);
const state = vi.hoisted(() => ({ user: null as User | null }));
const reloadStores = vi.hoisted(() => vi.fn());
vi.mock('../features/auth/authStore', () => ({
  useAuthStore: (select: (s: typeof state) => unknown) => select(state),
}));
vi.mock('../features/stores/useStores', () => ({ useStores: () => ({ retry: reloadStores }) }));

const { ManageHoursPage } = await import('./ManageHours');
const { ApiError } = await import('../services/api');
const { canAddInterval } = await import('../features/manage/hoursRules');

const store = { id: 's1', brand: { id: 'b1', name: 'B', slug: 'b' } };
const membership = { storeId: 's1', storeSlug: 's1', storeName: 'S', role: 'MANAGER' } as const;
const manager = { role: 'CUSTOMER', memberships: [membership], ownedBrands: [] } as unknown as User;
const week = (hours: StoreScheduleResponse['hours'] = [], exceptions = []) =>
  ({ timezone: 'Asia/Kolkata', hours, exceptions }) as StoreScheduleResponse;
const monday = { dayOfWeek: 1, opensAt: '09:00', closesAt: '17:00' };
const onChanged = vi.fn();
const show = () => render(<ManageHoursPage store={store} onChanged={onChanged} />);

beforeEach(() => {
  vi.resetAllMocks();
  state.user = manager;
  api.fetchStoreHours.mockResolvedValue(week([monday]));
});

describe('ManageHoursPage', () => {
  it('offers no interval past the end of the day', () => {
    expect(canAddInterval([{ opensAt: '18:00', closesAt: '23:59' }])).toBe(false);
    expect(canAddInterval([{ opensAt: '22:00', closesAt: '02:00' }])).toBe(false);
    expect(canAddInterval([{ opensAt: '09:00', closesAt: '17:00' }])).toBe(true);
  });

  it('shows a skeleton while loading', () => {
    api.fetchStoreHours.mockReturnValue(new Promise(() => {}));
    show();
    expect(screen.getByLabelText('Loading the hours')).toBeInTheDocument();
  });

  it('says so when no hours are set yet', async () => {
    api.fetchStoreHours.mockResolvedValue(week());
    show();
    expect(await screen.findByText('No opening hours yet')).toBeInTheDocument();
  });

  it('offers a retry when the hours fail to load', async () => {
    api.fetchStoreHours.mockRejectedValueOnce(new ApiError(500, 'X', 'Server down'));
    show();
    expect(await screen.findByText('Server down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByLabelText('Monday opens')).toHaveValue('09:00');
  });

  it('edits and saves the whole week, then reloads the hours, the store and the list', async () => {
    api.saveStoreHours.mockResolvedValue(week());
    show();
    fireEvent.change(await screen.findByLabelText('Monday closes'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Tuesday hours' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.saveStoreHours).toHaveBeenCalledWith('s1', [
      { dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' },
      { dayOfWeek: 2, opensAt: '09:00', closesAt: '17:00' },
    ]);
    expect(reloadStores).toHaveBeenCalled();
    expect(api.fetchStoreHours).toHaveBeenCalledTimes(2);
  });

  it("shows the server's overlap error inline and keeps the edit", async () => {
    api.saveStoreHours.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'Monday 09:00-17:00 overlaps Monday 16:00-20:00.'),
    );
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Monday hours' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('overlaps');
    expect(screen.getAllByLabelText('Monday opens')).toHaveLength(2);
  });

  it('removes an interval and copies a day to all days', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy Monday to all days' }));
    expect(screen.getAllByLabelText(/ opens$/)).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sunday interval 1' }));
    expect(screen.getAllByLabelText(/ opens$/)).toHaveLength(6);
  });

  it('adds a special day from a preset and removes one', async () => {
    const day = '2030-01-01';
    const holiday = { id: 'e1', startsOn: day, endsOn: day, kind: 'CLOSED', label: 'Holiday' };
    api.fetchStoreHours.mockResolvedValue(
      week([monday], [{ ...holiday, opensAt: null, closesAt: null }] as never),
    );
    api.createScheduleException.mockResolvedValue({});
    api.deleteScheduleException.mockRejectedValue(
      new ApiError(500, 'INTERNAL', 'Could not remove.'),
    );
    show();
    fireEvent.change(await screen.findByLabelText('Monday closes'), { target: { value: '18:00' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Closed for …' }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Closed for Diwali' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add special day' }));
    await waitFor(() => expect(api.createScheduleException).toHaveBeenCalled());
    const body = api.createScheduleException.mock.calls[0]![1];
    expect(body).toMatchObject({ kind: 'CLOSED', label: 'Closed for Diwali' });
    expect(body.opensAt).toBeUndefined();
    await waitFor(() => expect(api.fetchStoreHours).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Monday closes')).toHaveValue('18:00');

    const row = screen.getByText('Holiday').closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Remove Holiday' }));
    await waitFor(() => expect(api.deleteScheduleException).toHaveBeenCalledWith('s1', 'e1'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove.');
  });

  it('offers an admin no editor, and never loads the hours for them', () => {
    state.user = { ...manager, role: 'ADMIN', memberships: [] };
    show();
    expect(
      screen.getByText(/Only the store's manager or owner can edit hours/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save hours' })).toBeNull();
    expect(api.fetchStoreHours).not.toHaveBeenCalled();
  });
});
