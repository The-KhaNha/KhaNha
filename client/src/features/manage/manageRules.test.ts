import { describe, expect, it } from 'vitest';
import type { ManagedStore, MyBrand } from '../../types/api';
import { ownedBranch } from './manageRules';

const store = (slug: string, isTemplate = false): ManagedStore => ({
  id: `id-${slug}`,
  slug,
  name: slug,
  status: 'ACTIVE',
  isTemplate,
  area: null,
  address: null,
  contactPhone: null,
  tagline: '',
  description: '',
  imageUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
});
const brand = (stores: ManagedStore[], template: ManagedStore | null = null): MyBrand => ({
  id: 'b1',
  name: 'B',
  slug: 'b',
  template,
  stores,
});

describe('ownedBranch', () => {
  it('finds a branch by slug across brands', () => {
    const brands = [brand([store('a')]), brand([store('b'), store('c')])];
    expect(ownedBranch(brands, 'c')?.id).toBe('id-c');
  });

  it('never returns the template, even by its own slug', () => {
    expect(ownedBranch([brand([store('a')], store('tpl', true))], 'tpl')).toBeNull();
  });

  it('never returns a template even when it is listed among the stores (a template has no board)', () => {
    expect(ownedBranch([brand([store('t', true), store('a')])], 't')).toBeNull();
  });

  it('is null for an unknown slug, no brands, or not loaded', () => {
    expect(ownedBranch([brand([store('a')])], 'zzz')).toBeNull();
    expect(ownedBranch([], 'a')).toBeNull();
    expect(ownedBranch(null, 'a')).toBeNull();
    expect(ownedBranch(undefined, 'a')).toBeNull();
  });
});
