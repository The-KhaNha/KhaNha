import { describe, expect, it, vi } from 'vitest';
import { currentUser, requireAdmin, requireStaff } from '../../src/middleware/auth';
import type { AuthUser } from '../../src/types/auth';

function reqWith(user?: AuthUser): { user?: AuthUser } {
  return { user };
}

const staff: AuthUser = { id: 'u-staff', role: 'STAFF' };
const admin: AuthUser = { id: 'u-admin', role: 'ADMIN' };
const customer: AuthUser = { id: 'u-customer', role: 'CUSTOMER' };

describe('currentUser', () => {
  it('returns req.user when requireAuth has set it', () => {
    expect(currentUser(reqWith(staff))).toBe(staff);
  });

  it('throws 401 UNAUTHORIZED when requireAuth never ran', () => {
    expect(() => currentUser(reqWith(undefined))).toThrowError(
      expect.objectContaining({ status: 401, code: 'UNAUTHORIZED' }),
    );
  });
});

describe('requireAdmin', () => {
  it('calls next() for an ADMIN', () => {
    const next = vi.fn();
    requireAdmin(reqWith(admin) as never, {} as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('throws 403 FORBIDDEN for staff (an admin has no staff powers, and staff has no admin powers)', () => {
    const next = vi.fn();
    expect(() => requireAdmin(reqWith(staff) as never, {} as never, next)).toThrowError(
      expect.objectContaining({ status: 403, code: 'FORBIDDEN' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('throws 403 FORBIDDEN for a customer', () => {
    const next = vi.fn();
    expect(() => requireAdmin(reqWith(customer) as never, {} as never, next)).toThrowError(
      expect.objectContaining({ status: 403, code: 'FORBIDDEN' }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireStaff', () => {
  it('calls next() for STAFF', () => {
    const next = vi.fn();
    requireStaff(reqWith(staff) as never, {} as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws 403 FORBIDDEN for an ADMIN (no staff powers)', () => {
    const next = vi.fn();
    expect(() => requireStaff(reqWith(admin) as never, {} as never, next)).toThrowError(
      expect.objectContaining({ status: 403, code: 'FORBIDDEN' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('throws 403 FORBIDDEN for a customer', () => {
    const next = vi.fn();
    expect(() => requireStaff(reqWith(customer) as never, {} as never, next)).toThrowError(
      expect.objectContaining({ status: 403, code: 'FORBIDDEN' }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
