import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SiteSettings } from '../types/api';

const admin = vi.hoisted(() => ({
  fetchSiteSettings: vi.fn(),
  updateSiteSettings: vi.fn(),
}));
vi.mock('../services/admin', () => admin);
vi.mock('../services/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

const { AdminPage } = await import('./Admin');
const { ApiError } = await import('../services/api');

const saved: SiteSettings = {
  customerOrderHistoryLimit: 20,
  maxLinesPerOrder: 30,
  orderPollMs: 4000,
  ordersPollMs: 8000,
  staffBoardPollMs: 4000,
  clientErrorSamplePercent: 100,
  minClientVersion: '0.0.0',
  updatedAt: '2026-09-27T00:00:00Z',
};

describe('AdminPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the loaded values', async () => {
    admin.fetchSiteSettings.mockResolvedValue(saved);
    render(<AdminPage />);

    expect(await screen.findByLabelText('Customer order history')).toHaveValue('20');
    // The staff list limit is a per-store setting now: no field for it here.
    expect(screen.queryByLabelText('Staff board size')).toBeNull();
  });

  it('renders every setting in the registry, the poll intervals and the minimum version included', async () => {
    admin.fetchSiteSettings.mockResolvedValue(saved);
    render(<AdminPage />);

    expect(await screen.findByLabelText('Items per order')).toHaveValue('30');
    expect(screen.getByLabelText('Order page refresh (ms)')).toHaveValue('4000');
    expect(screen.getByLabelText('Order list refresh (ms)')).toHaveValue('8000');
    expect(screen.getByLabelText('Staff board refresh (ms)')).toHaveValue('4000');
    expect(screen.getByLabelText('Minimum app version')).toHaveValue('0.0.0');
  });

  it('sends a changed poll interval as a number and a version as text', async () => {
    admin.fetchSiteSettings.mockResolvedValue(saved);
    admin.updateSiteSettings.mockResolvedValue({
      ...saved,
      orderPollMs: 6000,
      minClientVersion: '0.2.0',
    });
    render(<AdminPage />);

    fireEvent.change(await screen.findByLabelText('Order page refresh (ms)'), {
      target: { value: '6000' },
    });
    fireEvent.change(screen.getByLabelText('Minimum app version'), { target: { value: '0.2.0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(admin.updateSiteSettings).toHaveBeenCalledWith({
        orderPollMs: 6000,
        minClientVersion: '0.2.0',
      });
    });
  });

  it('rejects a malformed version before sending', async () => {
    admin.fetchSiteSettings.mockResolvedValue(saved);
    render(<AdminPage />);

    fireEvent.change(await screen.findByLabelText('Minimum app version'), {
      target: { value: '1.2' },
    });

    expect(await screen.findByText('Enter a version like 1.2.3.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('disables Save until a field changes', async () => {
    admin.fetchSiteSettings.mockResolvedValue(saved);
    render(<AdminPage />);
    await screen.findByLabelText('Customer order history');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('disables Save when a changed field is invalid, even though it differs from the saved value', async () => {
    admin.fetchSiteSettings.mockResolvedValue(saved);
    render(<AdminPage />);
    const input = await screen.findByLabelText('Customer order history');

    fireEvent.change(input, { target: { value: '0' } });

    expect(await screen.findByText('Must be between 1 and 200.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('confirms a save and keeps keyboard focus on the page, not <body>', async () => {
    admin.fetchSiteSettings.mockResolvedValue(saved);
    admin.updateSiteSettings.mockResolvedValue({
      ...saved,
      customerOrderHistoryLimit: 25,
      updatedAt: '2026-09-28T00:00:00Z',
    });
    render(<AdminPage />);
    fireEvent.change(await screen.findByLabelText('Customer order history'), {
      target: { value: '25' },
    });
    const save = screen.getByRole('button', { name: 'Save' });
    save.focus();
    fireEvent.click(save);

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Saved');
    expect(document.activeElement).toBe(status);
    // Typing again hides the confirmation until the next save.
    fireEvent.change(screen.getByLabelText('Customer order history'), { target: { value: '26' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('sends only the field that changed', async () => {
    admin.fetchSiteSettings.mockResolvedValue(saved);
    admin.updateSiteSettings.mockResolvedValue({ ...saved, customerOrderHistoryLimit: 25 });
    render(<AdminPage />);
    const input = await screen.findByLabelText('Customer order history');

    fireEvent.change(input, { target: { value: '25' } });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() => {
      expect(admin.updateSiteSettings).toHaveBeenCalledWith({ customerOrderHistoryLimit: 25 });
    });
  });

  it('shows the API error message from a failed save', async () => {
    admin.fetchSiteSettings.mockResolvedValue(saved);
    admin.updateSiteSettings.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'Someone else just changed these settings.'),
    );
    render(<AdminPage />);
    const input = await screen.findByLabelText('Customer order history');

    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone else just changed these settings.',
    );
  });
});
