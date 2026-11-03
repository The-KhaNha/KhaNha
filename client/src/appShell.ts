import { matchPath } from 'react-router-dom';
import type { TopBarTone } from './components/TopBar';
import { APP_TITLE } from './config/app';

/** Which chrome (top bar, bottom nav, cart) each route gets, and its title. Read by App's shell. */
interface ShellConfig {
  /** The page's name: the tab title and what a screen reader hears on arrival. Required, so no route ships untitled. */
  title: string;
  /** null hides the TopBar entirely. No title = wordmark. */
  topBar: { title?: string; backTo?: string; tone?: TopBarTone } | null;
  bottomNav: boolean;
  cartButton: boolean;
  cartBar: boolean;
  /** 'column' = centred phone-width column; 'full' = the page owns its layout. */
  layout: 'column' | 'full';
  /** Desktop column width. 'wide' gives the menu's two-column food grid room so titles don't truncate. */
  width?: 'default' | 'wide';
}

const column: Pick<ShellConfig, 'bottomNav' | 'cartButton' | 'cartBar' | 'layout'> = {
  bottomNav: true,
  cartButton: true,
  cartBar: false,
  layout: 'column',
};

/** The page owns the whole screen: no top bar, bottom nav or cart. */
const fullScreen: Omit<ShellConfig, 'title'> = {
  topBar: null,
  bottomNav: false,
  cartButton: false,
  cartBar: false,
  layout: 'full',
};

const SHELL_BY_ROUTE: { pattern: string; config: ShellConfig }[] = [
  {
    pattern: '/',
    config: { ...column, title: APP_TITLE, topBar: { tone: 'brand' }, cartBar: true },
  },
  {
    pattern: '/menu',
    config: {
      ...column,
      title: 'Menu',
      topBar: { title: 'Menu', backTo: '/' },
      cartBar: true,
      width: 'wide',
    },
  },
  {
    pattern: '/cart',
    config: {
      ...column,
      title: 'Your cart',
      topBar: { title: 'Your cart', backTo: '/menu' },
      cartButton: false,
    },
  },
  {
    pattern: '/checkout',
    config: {
      ...column,
      title: 'Checkout',
      topBar: { title: 'Checkout', backTo: '/cart' },
      cartButton: false,
    },
  },
  {
    pattern: '/orders',
    config: { ...column, title: 'Your orders', topBar: { title: 'Your orders', backTo: '/' } },
  },
  // Announced on arrival, before the page knows the order exists (a stale or typed link 404s): never "Order placed".
  { pattern: '/orders/:id/success', config: { ...fullScreen, title: 'Order confirmation' } },
  {
    pattern: '/orders/:id',
    config: {
      ...column,
      title: 'Order details',
      topBar: { title: 'Order details', backTo: '/orders' },
    },
  },
  {
    pattern: '/profile',
    config: { ...column, title: 'Profile', topBar: { title: 'Profile', backTo: '/' } },
  },
  {
    pattern: '/admin',
    config: {
      ...column,
      title: 'Site settings',
      topBar: { title: 'Admin', backTo: '/profile' },
      cartButton: false,
      // The operator's page: the customer tabs do not apply to it, and the form gets the height.
      bottomNav: false,
    },
  },
  { pattern: '/login', config: { ...fullScreen, title: 'Sign in' } },
  { pattern: '/register', config: { ...fullScreen, title: 'Create your account' } },
  { pattern: '/staff', config: { ...fullScreen, title: 'Staff board' } },
];

const NOT_FOUND_SHELL: ShellConfig = {
  ...column,
  title: 'Page not found',
  topBar: { title: 'Not found', backTo: '/' },
  cartButton: false,
};

/** The tab title for a page's name. Also used by a page whose state outgrows its route's title (OrderSuccess). */
export function documentTitle(title: string): string {
  return title === APP_TITLE ? APP_TITLE : `${title} · ${APP_TITLE}`;
}

export function getShellConfig(pathname: string): ShellConfig {
  for (const { pattern, config } of SHELL_BY_ROUTE) {
    if (matchPath({ path: pattern, end: true }, pathname)) return config;
  }
  return NOT_FOUND_SHELL;
}
