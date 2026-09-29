// Injected at build time by `define` in vite.config.ts and vitest.config.ts.

/** This build's released version (client/package.json). Sent as X-Client-Version and shown in Profile. */
export const APP_VERSION: string = __APP_VERSION__;

/** The commit it was built from ('local' outside CI); staging builds share a version, so this tells them apart. */
export const APP_COMMIT: string = __APP_COMMIT__;
