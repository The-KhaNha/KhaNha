import type { RequestHandler } from 'express';

/**
 * Browser hardening on every API response, so the API is safe when reached directly (dev, a bare deployment)
 * and not only behind the web image's nginx (client/nginx/security.conf.template carries the page's headers).
 * The API serves JSON only: nothing may frame it, sniff it into HTML, or run inside it. HSTS is sent only on a
 * request that arrived over TLS (req.secure honours X-Forwarded-Proto through `trust proxy`), so plain local HTTP
 * never pins the browser; one day, raised once staging has run on TLS for a while (docs/DEPLOYMENT.md).
 */
export const securityHeaders: RequestHandler = (req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=86400');
  next();
};
