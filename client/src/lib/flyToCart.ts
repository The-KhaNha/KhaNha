import { prefersReducedMotion } from './useReducedMotion';

/** Fired on `window` when a flying photo lands on the cart icon. CartButton listens and tilts. */
export const CART_LANDED_EVENT = 'cart:landed';

const CLONE_SIZE = 28;
const FLIGHT_MS = 480;

/**
 * Flies a small round clone of the item photo from `source` to the cart icon (`[data-cart-target]`).
 * Skips silently when there is no cart icon on screen or the person prefers reduced motion.
 * Two getBoundingClientRect calls, one element.animate — nothing else.
 */
export function flyToCart(source: HTMLElement, imageUrl: string | null): void {
  if (prefersReducedMotion()) return;
  const target = document.querySelector<HTMLElement>('[data-cart-target]');
  if (!target || typeof source.animate !== 'function') return;

  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (from.width === 0 || to.width === 0) return;

  const startX = from.left + from.width / 2 - CLONE_SIZE / 2;
  const startY = from.top + from.height / 2 - CLONE_SIZE / 2;
  const dx = to.left + to.width / 2 - CLONE_SIZE / 2 - startX;
  const dy = to.top + to.height / 2 - CLONE_SIZE / 2 - startY;

  const clone = document.createElement('div');
  clone.setAttribute('data-flight', '');
  clone.setAttribute('aria-hidden', 'true');
  clone.style.cssText = [
    'position:fixed',
    `left:${startX}px`,
    `top:${startY}px`,
    `width:${CLONE_SIZE}px`,
    `height:${CLONE_SIZE}px`,
    'border-radius:9999px',
    'z-index:60',
    'pointer-events:none',
    'box-shadow:0 4px 12px rgba(27,20,16,.28), inset 0 0 0 1px rgba(27,20,16,.08)',
    'will-change:transform,opacity',
    imageUrl ? `background:url("${imageUrl}") center/cover` : 'background:var(--color-brand-500)',
  ].join(';');
  document.body.appendChild(clone);

  const animation = clone.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(0.7)`, opacity: 0.9, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.3)`, opacity: 0.6 },
    ],
    { duration: FLIGHT_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
  );

  const cleanup = () => clone.remove();
  animation.onfinish = () => {
    cleanup();
    window.dispatchEvent(new CustomEvent(CART_LANDED_EVENT));
  };
  animation.oncancel = cleanup;
}
