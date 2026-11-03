import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { prefetchMenu } from './services/menu';
import { prefetchStore } from './services/store';
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
if (window.location.pathname === '/menu') prefetchMenu();
else if (window.location.pathname === '/') prefetchStore();

// A signed-in visit needs supabase-js for its first request (the access token). Start the chunk now, alongside the
// page's own lazy chunk, rather than from the first render's effects; an anonymous visitor never loads it. A failed
// load (offline) is retried by the first request.
if (mayHaveSession()) getSupabase().catch(() => undefined);

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
