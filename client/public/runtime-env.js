// Development and the staging build: nothing set at runtime, so lib/runtimeEnv.ts uses the build values. In the web
// image nginx serves a generated file at this path instead (nginx/runtime-env.sh).
window.__RUNTIME_ENV__ = {};
