import { lazy, useEffect, useRef } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { BottomNav } from './components/BottomNav';
import { CartButton } from './components/CartButton';
import { PageBoundary } from './components/PageBoundary';
import { TopBar } from './components/TopBar';
import { useAuthStore } from './features/auth/authStore';
import { RequireAuth } from './features/auth/RequireAuth';
import { RequireRole } from './features/auth/RequireRole';
import { CartBar } from './features/cart/CartBar';
import { selectCount, useCartStore } from './features/cart/cartStore';
import { OutdatedBanner } from './features/version/OutdatedBanner';
import { APP_TITLE } from './config/app';
import { getShellConfig } from './appShell';
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

const WIDTH_CLASS = { default: 'max-w-md md:max-w-lg', wide: 'max-w-md md:max-w-2xl' } as const;

function AppShell() {
  const { pathname } = useLocation();
  const config = getShellConfig(pathname);
  const cartCount = useCartStore(selectCount);
  const showCartBar = config.cartBar && cartCount > 0;
  const widthClass = WIDTH_CLASS[config.width ?? 'default'];
  const pageRef = useRef<HTMLDivElement>(null);
  const firstPage = useRef(true);

  // Every navigation: the tab title follows the page, the view starts at the top, and (after the first page) keyboard
  // focus moves to the new page too, so the next Tab reaches its first control instead of carrying on from where the
  // old page's link was. The live region below says the page's name, which a title change alone never announces.
  useEffect(() => {
    document.title = config.title === APP_TITLE ? APP_TITLE : `${config.title} · ${APP_TITLE}`;
    window.scrollTo(0, 0);
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    pageRef.current?.focus({ preventScroll: true });
  }, [pathname, config.title]);

  const routes = (
    <div ref={pageRef} tabIndex={-1} className="focus:outline-none">
      <p aria-live="polite" className="sr-only">
        {config.title}
      </p>
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
    </div>
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
      <OutdatedBanner />
      <AppShell />
    </BrowserRouter>
  );
}
