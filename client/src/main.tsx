import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { prefetchStoreMenu, prefetchStores } from './services/stores';
import { getSupabase, mayHaveSession } from './lib/supabase';
import { installErrorReporter } from './lib/errorReporter';
import './index.css';

installErrorReporter();

// The webfont was preloaded without blocking the first paint (index.html); applying it here, not in an inline onload,
// keeps the CSP free of 'unsafe-inline' scripts. A dynamically applied stylesheet never blocks rendering.
document
  .querySelector<HTMLLinkElement>('link[data-font-stylesheet]')
  ?.setAttribute('rel', 'stylesheet');

// The landing page's data starts now, while the app renders its skeleton, not after the first render has run its
// effects (render-as-you-fetch). Only the page the visitor landed on, and only public data.
const landedMenu = /^\/s\/([^/]+)\/menu$/.exec(window.location.pathname);
if (landedMenu) prefetchStoreMenu(decodeURIComponent(landedMenu[1]!));
else if (window.location.pathname === '/') prefetchStores();

// A signed-in visit needs supabase-js for its first request (the access token). Start the chunk now, alongside the
// page's own lazy chunk, rather than from the first render's effects; an anonymous visitor never loads it. A load
// that fails twice is kept, and the first request then asks for a reload (CLIENT_RELOAD_REQUIRED in services/api.ts).
if (mayHaveSession()) getSupabase().catch(() => undefined);

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
