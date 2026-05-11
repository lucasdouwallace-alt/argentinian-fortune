import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchCclResult } from "./ccl.functions";

const CCL_URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/contadoConLiqui";
const MEP_URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/mep";

describe("fetchCclResult", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ccl when contadoConLiqui responds OK", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url) === CCL_URL) {
        return new Response(JSON.stringify([{ venta: 1500 }, { venta: 1520.5 }]), { status: 200 });
      }
      throw new Error("unexpected url");
    });

    const r = await fetchCclResult();
    expect(r.ok).toBe(true);
    expect(r.value).toBe(1520.5);
    expect(r.source).toBe("ccl");
    expect(r.attempts).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to MEP when contadoConLiqui fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url) === CCL_URL) return new Response("err", { status: 503 });
      if (String(url) === MEP_URL) {
        return new Response(JSON.stringify([{ venta: 1480 }]), { status: 200 });
      }
      throw new Error("unexpected url");
    });

    const r = await fetchCclResult();
    expect(r.ok).toBe(true);
    expect(r.value).toBe(1480);
    expect(r.source).toBe("mep");
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts[0].ok).toBe(false);
    expect(r.attempts[0].status).toBe(503);
    expect(r.attempts[1].ok).toBe(true);
  });

  it("returns ok=false when both endpoints fail", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("err", { status: 500 });
    });

    const r = await fetchCclResult();
    expect(r.ok).toBe(false);
    expect(r.value).toBe(0);
    expect(r.source).toBe("none");
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts.every((a) => !a.ok)).toBe(true);
  });
});
