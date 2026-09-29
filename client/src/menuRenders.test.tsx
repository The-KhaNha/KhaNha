import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    name: 'Campus Cafe',
    tagline: 'Coffee',
    description: '',
    imageUrl: null,
    isOpen: true,
    prepTimeMinMinutes: 10,
    prepTimeMaxMinutes: 15,
  },
  popular: [],
  categories: [
    { name: 'Coffee', items: items.filter((i) => i.category === 'Coffee') },
    { name: 'Snacks', items: items.filter((i) => i.category === 'Snacks') },
  ],
};
vi.mock('./features/menu/useMenu', () => ({
  useMenu: () => ({ menu, isLoading: false, error: null, retry: () => {} }),
}));
const { default: App } = await import('./App');

// A real menu can hold up to 500 items (MENU_ITEMS_MAX): a tap that re-renders every card took 400-570 ms on a slow
// phone, against the 200 ms INP budget. Adding one item re-renders that card, not the list.
describe('menu re-renders', () => {
  it('adding an item re-renders its own card, not the other nineteen', () => {
    window.history.pushState({}, '', '/menu');
    render(<App />);
    const before = priceRenders.count;
    act(() => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Add to cart' })[3]!);
    });
    expect(priceRenders.count - before).toBeLessThanOrEqual(3);
  });

  // The React side above is half of it: 500 cards on the page still cost 130-250 ms per tap in style, layout and paint.
  // A category off screen skips all three, with a rem size estimate until it is first drawn.
  it('lets a category off screen skip rendering', () => {
    window.history.pushState({}, '', '/menu');
    const { container } = render(<App />);
    const sections = container.querySelectorAll<HTMLElement>('section[id^="section-"]');
    expect(sections.length).toBe(2);
    for (const section of sections) {
      expect(section.className).toContain('[content-visibility:auto]');
      expect(section.getAttribute('style')).toMatch(/contain-intrinsic-size:\s*auto [\d.]+rem/);
    }
  });
});
