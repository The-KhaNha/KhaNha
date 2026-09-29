import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { StaffHeader } from './StaffHeader';

describe('StaffHeader', () => {
  // The board is full-screen with no bottom nav: without this link staff could only leave by typing a URL.
  it('links to the profile next to Log out', () => {
    render(
      <MemoryRouter>
        <StaffHeader now={new Date()} updatedAt={null} offline={false} onLogout={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });
});
