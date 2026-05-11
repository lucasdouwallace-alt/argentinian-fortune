import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// Mock @tanstack/react-start: useServerFn returns the function passed in.
vi.mock("@tanstack/react-start", () => ({
  useServerFn: <T,>(fn: T) => fn,
  createServerFn: () => ({
    handler: (h: unknown) => h,
  }),
}));

// Mock monitoring to avoid Sentry init in jsdom.
vi.mock("@/lib/monitoring", () => ({
  captureCclFailure: vi.fn(),
  captureCclSuccess: vi.fn(),
}));

const getCclMock = vi.fn();
vi.mock("@/lib/ccl.functions", () => ({
  getCcl: (...args: unknown[]) => getCclMock(...args),
}));

import { useCcl, computeBackoffMs } from "./useCcl";

const STORAGE_KEY = "oraculo:ccl_last";

function okResult(value: number, source: "ccl" | "mep" = "ccl") {
  return {
    ok: true,
    value,
    source,
    fetched_at: new Date().toISOString(),
    duration_ms: 12,
    attempts: [{ source, ok: true, duration_ms: 12, status: 200 }],
  };
}
function failResult() {
  return {
    ok: false,
    value: 0,
    source: "none" as const,
    fetched_at: new Date().toISOString(),
    duration_ms: 30,
    attempts: [
      { source: "ccl" as const, ok: false, duration_ms: 15, status: 500, error: "HTTP 500" },
      { source: "mep" as const, ok: false, duration_ms: 15, status: 500, error: "HTTP 500" },
    ],
  };
}

describe("computeBackoffMs", () => {
  it("returns 30s with no failures and grows exponentially", () => {
    expect(computeBackoffMs(0)).toBe(30_000);
    expect(computeBackoffMs(1)).toBe(30_000);
    expect(computeBackoffMs(2)).toBe(60_000);
    expect(computeBackoffMs(3)).toBe(120_000);
    expect(computeBackoffMs(10)).toBe(5 * 60_000); // capped
  });
});

describe("useCcl", () => {
  beforeEach(() => {
    localStorage.clear();
    getCclMock.mockReset();
  });

  it("returns ccl source when contadoConLiqui succeeds and writes cache", async () => {
    getCclMock.mockResolvedValue(okResult(1520, "ccl"));
    const { result } = renderHook(() => useCcl());

    await waitFor(() => expect(result.current.lastResult?.ok).toBe(true));
    expect(result.current.effective).toBe(1520);
    expect(result.current.lastResult?.source).toBe("ccl");
    expect(result.current.consecutiveFailures).toBe(0);

    const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    expect(cached.value).toBe(1520);
    expect(cached.source).toBe("ccl");
  });

  it("uses MEP value when fallback succeeds", async () => {
    getCclMock.mockResolvedValue(okResult(1480, "mep"));
    const { result } = renderHook(() => useCcl());

    await waitFor(() => expect(result.current.lastResult?.ok).toBe(true));
    expect(result.current.effective).toBe(1480);
    expect(result.current.lastResult?.source).toBe("mep");
  });

  it("falls back to localStorage cache when both endpoints fail", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ value: 1400, source: "ccl", ts: Date.now() - 60_000 }),
    );
    getCclMock.mockResolvedValue(failResult());

    const { result } = renderHook(() => useCcl());

    await waitFor(() => expect(result.current.lastResult?.ok).toBe(false));
    expect(result.current.effective).toBe(1400);
    expect(result.current.lastKnown?.value).toBe(1400);
    expect(result.current.consecutiveFailures).toBe(1);
    expect(result.current.nextPollMs).toBe(30_000);
  });

  it("refresh() triggers an immediate refetch", async () => {
    getCclMock.mockResolvedValue(okResult(1500, "ccl"));
    const { result } = renderHook(() => useCcl());
    await waitFor(() => expect(result.current.lastResult?.ok).toBe(true));

    const initialCalls = getCclMock.mock.calls.length;
    getCclMock.mockResolvedValue(okResult(1555, "ccl"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(getCclMock.mock.calls.length).toBeGreaterThan(initialCalls);
    expect(result.current.effective).toBe(1555);
  });
});
