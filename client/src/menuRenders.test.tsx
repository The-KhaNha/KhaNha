import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CARD_GROUP } from './lib/chunked';
import type { MenuItem, MenuResponse } from './types/api';

// jsdom has neither; the menu's category chips and photos observe layout.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopObserver);
vi.stubGlobal('IntersectionObserver', NoopObserver);
Element.prototype.scrollTo = () => {};
window.scrollTo = (() => {}) as typeof window.scrollTo;

vi.mock('./lib/supabase', () => ({
  getSupabase: () => new Promise(() => {}),
  mayHaveSession: () => false,
}));
// Every food card shows one Price: counting its renders counts the cards that re-rendered.
const priceRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('./components/Price', () => ({
  Price: ({ value }: { value: number }) => {
    priceRenders.count += 1;
    return <span>{value}</span>;
  },
}));

const item = (i: number): MenuItem => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  category: i % 2 ? 'Snacks' : 'Coffee',
  name: `Item ${i}`,
  description: 'Tasty',
  price: 100 + i,
  imageUrl: '/images/cold-coffee.jpg',
  diet: null,
  isAvailable: true,
  isPopular: false,
  sortOrder: i,
  stockQuantity: null,
});
const items = Array.from({ length: 20 }, (_, i) => item(i));
const menu: MenuResponse = {
  rules: { maxQuantityPerItem: 10, lowStockThreshold: 5 },
  store: {
    id: 's1',
    slug: 'cafe',
    brand: { id: 'b1', name: 'Cafe', slug: 'cafe' },
    area: null,
    address: null,
    name: 'Campus Cafe',
    tagline: 'Coffee',
    description: '',
    imageUrl: null,
    isOpen: true,
    openState: 'OPEN',
    nextChangeAt: null,
    openLabel: null,
    prepTimeMinMinutes: 10,
    prepTimeMaxMinutes: 15,
  },
  popular: [],
  categories: [
    { name: 'Coffee', items: items.filter((i) => i.category === 'Coffee') },
    { name: 'Snacks', items: items.filter((i) => i.category === 'Snacks') },
  ],
};
vi.mock('./features/stores/useStoreMenu', () => ({
  useStoreMenu: () => ({ menu, isLoading: false, error: null, retry: () => {} }),
}));
const { default: App } = await import('./App');

// A real menu can hold up to 500 items (MENU_ITEMS_MAX): a tap that re-renders every card took 400-570 ms on a slow
// phone, against the 200 ms INP budget. Adding one item re-renders that card, not the list.
describe('menu re-renders', () => {
  it('adding an item re-renders its own card, not the other nineteen', () => {
    window.history.pushState({}, '', '/s/cafe/menu');
    render(<App />);
    const before = priceRenders.count;
    act(() => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Add to cart' })[3]!);
    });
    expect(priceRenders.count - before).toBeLessThanOrEqual(3);
  });

  // The React side above is half of it: 500 cards on the page still cost 130-250 ms per tap in style, layout and paint.
  // Groups of cards off screen skip all three (below). A section must not be contained too: WebKit could not scroll a
  // group inside a contained section into view to tap it.
  it('contains no menu section, only its groups of cards', () => {
    window.history.pushState({}, '', '/s/cafe/menu');
    const { container } = render(<App />);
    const sections = container.querySelectorAll<HTMLElement>('section[id^="section-"]');
    expect(sections.length).toBe(2);
    for (const section of sections) expect(section.className).not.toContain('content-visibility');
  });

  // One category of hundreds fills the screen, so its section never skips: its cards do, in groups (/break, P3
  // close). Never per card: WebKit could not scroll a contained card into view to tap it (6 e2e failures).
  it('lets a group of cards off screen skip rendering, inside one long category too, but never a single card', () => {
    window.history.pushState({}, '', '/s/cafe/menu');
    const { container } = render(<App />);
    const groups = container.querySelectorAll<HTMLElement>('section[id^="section-"] > div[style]');
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.className).toContain('[content-visibility:auto]');
      expect(group.className).toContain('[contain-intrinsic-size:auto_calc(var(--cards)*9.25rem)]');
      expect(group.querySelectorAll('article').length).toBeLessThanOrEqual(CARD_GROUP);
    }
    for (const card of container.querySelectorAll<HTMLElement>('article'))
      expect(card.className).not.toContain('content-visibility');
  });

  // content-visibility skips layout and paint, not React's mount: a menu of hundreds mounted every card at load, one
  // 180-240 ms task on a cheap phone (perf-auditor, P3 close). Only the groups near the screen mount.
  it('mounts only the first groups of a long menu until the rest near the screen', () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const categories = menu.categories;
    menu.categories = [
      {
        name: 'Coffee',
        items: Array.from({ length: 60 }, (_, i) => ({ ...item(100 + i), category: 'Coffee' })),
      },
    ];
    try {
      window.history.pushState({}, '', '/s/cafe/menu');
      const { container } = render(<App />);
      const cards = container.querySelectorAll('article').length;
      expect(cards).toBeGreaterThan(0);
      expect(cards).toBeLessThanOrEqual(2 * CARD_GROUP);
      expect(container.querySelectorAll('[data-lazy-group="waiting"]').length).toBeGreaterThan(0);
    } finally {
      menu.categories = categories;
      vi.unstubAllGlobals();
    }
  });
});
