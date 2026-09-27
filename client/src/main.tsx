import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// The webfont was preloaded without blocking the first paint (index.html); applying it here, not in an inline onload,
// keeps the CSP free of 'unsafe-inline' scripts. A dynamically applied stylesheet never blocks rendering.
document
  .querySelector<HTMLLinkElement>('link[data-font-stylesheet]')
  ?.setAttribute('rel', 'stylesheet');

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
