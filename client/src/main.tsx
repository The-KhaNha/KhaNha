import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { prefetchMenu } from './services/menu';
import { prefetchStore } from './services/store';
import './index.css';

// The webfont was preloaded without blocking the first paint (index.html); applying it here, not in an inline onload,
// keeps the CSP free of 'unsafe-inline' scripts. A dynamically applied stylesheet never blocks rendering.
document
  .querySelector<HTMLLinkElement>('link[data-font-stylesheet]')
  ?.setAttribute('rel', 'stylesheet');

// The landing page's data starts now, while the app renders its skeleton, not after the first render has run its
// effects (render-as-you-fetch). Only the page the visitor landed on, and only public data.
if (window.location.pathname === '/menu') prefetchMenu();
else if (window.location.pathname === '/') prefetchStore();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
