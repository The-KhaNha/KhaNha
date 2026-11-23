// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { homeOnHost, hostRedirect, hrefFor, sectionOfPath } from './hosts';

const hosts = { customer: 'khanha.in', staff: 'staff.khanha.in', admin: 'admin.khanha.in' };
const at = (host: string, pathname: string, search = '', hash = '') => ({
  host,
  protocol: 'https:',
  pathname,
  search,
  hash,
});

describe('sectionOfPath', () => {
  it.each([
    ['/', 'customer'],
    ['/s/campus-cafe/menu', 'customer'],
    ['/orders/1', 'customer'],
    ['/staffing', 'customer'],
    ['/staff', 'staff'],
    ['/staff/campus-cafe', 'staff'],
    ['/manage/campus-cafe/menu', 'staff'],
    ['/join', 'staff'],
    ['/admin', 'admin'],
    ['/Admin', 'admin'],
    ['/STAFF/campus-cafe', 'staff'],
    ['/login', null],
    ['/register', null],
    ['/profile', null],
  ])('%s is %s', (path, section) => {
    expect(sectionOfPath(path)).toBe(section);
  });
});

describe('hostRedirect', () => {
  it('does nothing while the hosts are unset (local, CI, staging)', () => {
    expect(hostRedirect(at('localhost', '/staff'), {})).toBeNull();
    expect(hostRedirect(at('localhost', '/admin'), { staff: 'staff.khanha.in' })).toBeNull();
  });

  it('sends a staff path on the apex to the staff host, query and fragment kept', () => {
    expect(hostRedirect(at('khanha.in', '/join', '?x=1', '#tok'), hosts)).toBe(
      'https://staff.khanha.in/join?x=1#tok',
    );
    expect(hostRedirect(at('khanha.in', '/admin'), hosts)).toBe('https://admin.khanha.in/admin');
  });

  it('sends a customer path on staff. or admin. to the apex', () => {
    expect(hostRedirect(at('staff.khanha.in', '/s/campus-cafe'), hosts)).toBe(
      'https://khanha.in/s/campus-cafe',
    );
    expect(hostRedirect(at('admin.khanha.in', '/cart'), hosts)).toBe('https://khanha.in/cart');
  });

  it('opens the section at the root of staff. and admin.', () => {
    expect(hostRedirect(at('staff.khanha.in', '/'), hosts)).toBe('/staff');
    expect(hostRedirect(at('admin.khanha.in', '/'), hosts)).toBe('/admin');
  });

  it('keeps the query and fragment when the root opens its section', () => {
    expect(hostRedirect(at('staff.khanha.in', '/', '?x=1', '#tok'), hosts)).toBe('/staff?x=1#tok');
  });

  it('matches a host setting written in capitals (host names ignore case)', () => {
    const shouting = { customer: 'KHANHA.IN', staff: 'STAFF.KHANHA.IN', admin: 'Admin.Khanha.In' };
    expect(hostRedirect(at('staff.khanha.in', '/'), shouting)).toBe('/staff');
    expect(hostRedirect(at('khanha.in', '/admin'), shouting)).toBe('https://Admin.Khanha.In/admin');
  });

  it('stays for a path of this host, and for sign-in on any host', () => {
    expect(hostRedirect(at('khanha.in', '/'), hosts)).toBeNull();
    expect(hostRedirect(at('staff.khanha.in', '/manage'), hosts)).toBeNull();
    expect(hostRedirect(at('admin.khanha.in', '/login'), hosts)).toBeNull();
  });

  it('sends /Admin on the apex to admin. too (the router ignores case)', () => {
    expect(hostRedirect(at('khanha.in', '/Admin'), hosts)).toBe('https://admin.khanha.in/Admin');
  });

  it("does nothing on a host that is none of the three (CloudFront's own, before go-live)", () => {
    expect(hostRedirect(at('d1234.cloudfront.net', '/admin'), hosts)).toBeNull();
    expect(hrefFor('/staff', at('d1234.cloudfront.net', '/'), hosts)).toBe('/staff');
    expect(homeOnHost('/admin', 'd1234.cloudfront.net', hosts)).toBe('/admin');
  });

  it('keeps a port that is part of the host setting', () => {
    const local = {
      customer: 'localhost:5173',
      staff: 'staff.localhost:5173',
      admin: 'admin.localhost:5173',
    };
    expect(hostRedirect({ ...at('localhost:5173', '/staff'), protocol: 'http:' }, local)).toBe(
      'http://staff.localhost:5173/staff',
    );
  });
});

describe('hrefFor', () => {
  it('is the path on its own host and a full URL on another', () => {
    expect(hrefFor('/staff', at('staff.khanha.in', '/'), hosts)).toBe('/staff');
    expect(hrefFor('/staff', at('khanha.in', '/'), hosts)).toBe('https://staff.khanha.in/staff');
    expect(hrefFor('/admin', at('khanha.in', '/'), {})).toBe('/admin');
  });
});

describe('homeOnHost', () => {
  it("keeps a sign-in on this host's section", () => {
    expect(homeOnHost('/admin', 'khanha.in', hosts)).toBe('/');
    expect(homeOnHost('/manage', 'staff.khanha.in', hosts)).toBe('/manage');
    expect(homeOnHost('/', 'staff.khanha.in', hosts)).toBe('/staff');
    expect(homeOnHost('/admin', 'localhost', {})).toBe('/admin');
  });
});
