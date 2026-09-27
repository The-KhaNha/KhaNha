import { lazy, useEffect } from 'react';
import { BrowserRouter, Route, Routes, matchPath, useLocation } from 'react-router-dom';
import { BottomNav } from './components/BottomNav';
import { CartButton } from './components/CartButton';
import { PageBoundary } from './components/PageBoundary';
import { TopBar, type TopBarTone } from './components/TopBar';
import { useAuthStore } from './features/auth/authStore';
import { RequireAuth } from './features/auth/RequireAuth';
import { RequireRole } from './features/auth/RequireRole';
import { CartBar } from './features/cart/CartBar';
import { selectCount, useCartStore } from './features/cart/cartStore';
import { cn } from './lib/cn';
import { CartPage } from './pages/Cart';
import { HomePage } from './pages/Home';
import { MenuPage } from './pages/Menu';
import { NotFoundPage } from './pages/NotFound';
import { OrderPage } from './pages/Order';
import { OrdersPage } from './pages/Orders';
import { ProfilePage } from './pages/Profile';

// Split out of the first download: the screens a customer does not need to browse and fill a cart (see CLAUDE.md §2b).
const CheckoutPage = lazy(() =>
  import('./pages/Checkout').then((m) => ({ default: m.CheckoutPage })),
);
const OrderSuccessPage = lazy(() =>
  import('./pages/OrderSuccess').then((m) => ({ default: m.OrderSuccessPage })),
);
const LoginPage = lazy(() => import('./pages/Login').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import('./pages/Register').then((m) => ({ default: m.RegisterPage })),
);
const AdminPage = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminPage })));
const StaffDashboardPage = lazy(() =>
  import('./pages/StaffDashboard').then((m) => ({ default: m.StaffDashboardPage })),
);

interface ShellConfig {
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

const WIDTH_CLASS = { default: 'max-w-md md:max-w-lg', wide: 'max-w-md md:max-w-2xl' } as const;

const column: Pick<ShellConfig, 'bottomNav' | 'cartButton' | 'cartBar' | 'layout'> = {
  bottomNav: true,
  cartButton: true,
  cartBar: false,
  layout: 'column',
};

/** The page owns the whole screen: no top bar, bottom nav or cart. */
const fullScreen: ShellConfig = {
  topBar: null,
  bottomNav: false,
  cartButton: false,
  cartBar: false,
  layout: 'full',
};

const SHELL_BY_ROUTE: { pattern: string; config: ShellConfig }[] = [
  { pattern: '/', config: { ...column, topBar: { tone: 'brand' }, cartBar: true } },
  {
    pattern: '/menu',
    config: { ...column, topBar: { title: 'Menu', backTo: '/' }, cartBar: true, width: 'wide' },
  },
  {
    pattern: '/cart',
    config: { ...column, topBar: { title: 'Your cart', backTo: '/menu' }, cartButton: false },
  },
  {
    pattern: '/checkout',
    config: { ...column, topBar: { title: 'Checkout', backTo: '/cart' }, cartButton: false },
  },
  { pattern: '/orders', config: { ...column, topBar: { title: 'Your orders', backTo: '/' } } },
  { pattern: '/orders/:id/success', config: fullScreen },
  {
    pattern: '/orders/:id',
    config: { ...column, topBar: { title: 'Order details', backTo: '/orders' } },
  },
  { pattern: '/profile', config: { ...column, topBar: { title: 'Profile', backTo: '/' } } },
  {
    pattern: '/admin',
    config: { ...column, topBar: { title: 'Admin', backTo: '/profile' }, cartButton: false },
  },
  { pattern: '/login', config: fullScreen },
  { pattern: '/register', config: fullScreen },
  { pattern: '/staff', config: fullScreen },
];

const NOT_FOUND_SHELL: ShellConfig = {
  ...column,
  topBar: { title: 'Not found', backTo: '/' },
  cartButton: false,
};

function getShellConfig(pathname: string): ShellConfig {
  for (const { pattern, config } of SHELL_BY_ROUTE) {
    if (matchPath({ path: pattern, end: true }, pathname)) return config;
  }
  return NOT_FOUND_SHELL;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function AppShell() {
  const { pathname } = useLocation();
  const config = getShellConfig(pathname);
  const cartCount = useCartStore(selectCount);
  const showCartBar = config.cartBar && cartCount > 0;
  const widthClass = WIDTH_CLASS[config.width ?? 'default'];

  const routes = (
    <PageBoundary key={pathname}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route
          path="/checkout"
          element={
            <RequireAuth>
              <CheckoutPage />
            </RequireAuth>
          }
        />
        <Route
          path="/orders"
          element={
            <RequireAuth>
              <OrdersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/orders/:id"
          element={
            <RequireAuth>
              <OrderPage />
            </RequireAuth>
          }
        />
        <Route
          path="/orders/:id/success"
          element={
            <RequireAuth>
              <OrderSuccessPage />
            </RequireAuth>
          }
        />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/staff"
          element={
            <RequireRole role="STAFF">
              <StaffDashboardPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireRole role="ADMIN">
              <AdminPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </PageBoundary>
  );

  if (config.layout === 'full') return routes;

  return (
    <div className="flex min-h-dvh flex-col">
      {config.topBar && (
        <TopBar
          {...config.topBar}
          widthClass={widthClass}
          right={config.cartButton ? <CartButton tone={config.topBar.tone} /> : undefined}
        />
      )}
      <main
        className={cn(
          'mx-auto w-full flex-1 px-4',
          widthClass,
          showCartBar
            ? 'pb-[calc(10rem+env(safe-area-inset-bottom))]'
            : config.bottomNav
              ? 'pb-[calc(6rem+env(safe-area-inset-bottom))]'
              : 'pb-8',
        )}
      >
        {routes}
      </main>
      {showCartBar && <CartBar widthClass={widthClass} />}
      {config.bottomNav && <BottomNav />}
    </div>
  );
}

export default function App() {
  useEffect(() => {
    void useAuthStore.getState().hydrate();
  }, []);

  return (
    <BrowserRouter>
      <ScrollToTop />
      <AppShell />
    </BrowserRouter>
  );
}
