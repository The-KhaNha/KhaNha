// Local only (localSql): the database's own ordering guarantees for orders: a cancel locks its items in the order
// place_order takes them, and events and audit rows are stamped when written.
import { describe, expect, it } from 'vitest';
import { localSql } from '../setup/helpers';

// Every function that writes menu_items rows. A bulk writer locks the rows it changes in id order first, the order
// place_order decrements them in, or a bulk write and a placement of the same items can deadlock (a 500).
const BULK_WRITERS = [
  'ensure_brand_template',
  'move_bundled_photo',
  'push_template_items',
  'reorder_menu',
  'set_menu_availability',
  'update_order_status',
];
// One row per statement: place_order's stock loop (already in id order) and adjust_stock (one item).
const SINGLE_ROW_WRITERS = ['adjust_stock', 'place_order'];

describe('ordering inside the database', () => {
  // A new writer fails here until it is one or the other: the class of the cancel's deadlock, not only its one line.
  it('every function that updates menu_items is a single-row writer or locks its rows in id order first', () => {
    const rows = localSql<{ name: string; src: string }>(
      `select proname as name, prosrc as src from pg_proc
        where pronamespace = 'public'::regnamespace and lower(prosrc) like '%update public.menu_items%'`,
    );
    expect(rows.map((r) => r.name).sort()).toEqual([...BULK_WRITERS, ...SINGLE_ROW_WRITERS].sort());
    for (const { name, src } of rows.filter((r) => BULK_WRITERS.includes(r.name))) {
      const flat = src.replace(/\s+/g, ' ').toLowerCase();
      const lock = flat.search(/from public\.menu_items [^;]*order by (m\.)?id for no key update/);
      expect(lock, name).toBeGreaterThan(-1);
      expect(lock, name).toBeLessThan(flat.indexOf('update public.menu_items'));
    }
  });

  // Stamped when written, not when the transaction began: a transition that waited on another's lock must still sort
  // after it, or an order's events and audit rows read CANCELLED before PREPARING.
  it.each(['domain_events', 'audit_log'])(
    '%s.occurred_at defaults to clock_timestamp()',
    (table) => {
      const [row] = localSql<{ column_default: string }>(
        `select column_default from information_schema.columns
        where table_schema = 'public' and table_name = '${table}' and column_name = 'occurred_at'`,
      );
      expect(row?.column_default).toBe('clock_timestamp()');
    },
  );

  // place_order takes item rows in id order; a cancel's restock must too, or the two can deadlock (a 500). The race is
  // too rare to reproduce on demand, so this pins the lock itself: the rows the restock updates, in id order, in the
  // restock's own mode (FOR UPDATE would wait on a placement's foreign-key FOR KEY SHARE and could deadlock instead).
  it('a cancel locks the items it restocks in id order, FOR NO KEY UPDATE, before it gives the stock back', () => {
    const [row] = localSql<{ src: string }>(
      `select prosrc as src from pg_proc where proname = 'update_order_status' and pronamespace = 'public'::regnamespace`,
    );
    const src = (row?.src ?? '').replace(/\s+/g, ' ');
    const lock = src.search(
      /from public\.menu_items where id in \(.*?\) and stock_quantity is not null order by id for no key update/,
    );
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(src.indexOf('update public.menu_items m'));
  });
});
