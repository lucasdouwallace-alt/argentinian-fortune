// Lightweight Sentry wrapper. If VITE_SENTRY_DSN is set, init the SDK lazily.
// Otherwise capture* helpers fall back to console so we never break the app.
import * as Sentry from "@sentry/react";

let initialized = false;
let enabled = false;

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const dsn = (import.meta as { env?: Record<string, string | undefined> })?.env?.VITE_SENTRY_DSN;
  if (!dsn) return;
  try {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      environment: (import.meta as { env?: Record<string, string | undefined> })?.env?.MODE ?? "production",
    });
    enabled = true;
  } catch (e) {
    console.warn("[monitoring] Sentry init failed", e);
  }
}

export type CclFailureContext = {
  source: "ccl" | "mep" | "none";
  durationMs: number;
  consecutiveFailures: number;
  url?: string;
  status?: number;
  message?: string;
};

export function captureCclFailure(ctx: CclFailureContext) {
  ensureInit();
  const payload = { tag: "ccl_failure", ...ctx, at: new Date().toISOString() };
  // Always log so failures are visible in browser/server console.
  console.warn("[ccl] failure", payload);
  if (enabled) {
    Sentry.captureMessage(`CCL/MEP failure (${ctx.source})`, {
      level: "warning",
      tags: { feature: "ccl", source: ctx.source },
      extra: payload,
    });
  }
}

export function captureCclSuccess(ctx: { source: "ccl" | "mep"; durationMs: number; recoveredAfter: number }) {
  ensureInit();
  if (ctx.recoveredAfter > 0) {
    const payload = { tag: "ccl_recovered", ...ctx, at: new Date().toISOString() };
    console.info("[ccl] recovered", payload);
    if (enabled) {
      Sentry.captureMessage(`CCL recovered after ${ctx.recoveredAfter} failures`, {
        level: "info",
        tags: { feature: "ccl", source: ctx.source },
        extra: payload,
      });
    }
  }
}
