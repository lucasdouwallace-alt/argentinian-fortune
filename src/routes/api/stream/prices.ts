import { createFileRoute } from "@tanstack/react-router";

// Proxy Alpaca IEX WebSocket -> SSE so the browser never sees the API keys.
// Each SSE connection opens its own upstream WS (fine for single-user dashboards).

const TICKERS = ["NVDA", "MELI", "PLTR", "VIST", "BMA"];
const ALPACA_WS = "https://stream.data.alpaca.markets/v2/iex";

export const Route = createFileRoute("/api/stream/prices")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env.ALPACA_API_KEY;
        const secret = process.env.ALPACA_SECRET_KEY;
        if (!key || !secret) {
          return new Response("Alpaca keys not configured", { status: 500 });
        }

        // The Worker WebSocket-over-fetch upgrade only works on Cloudflare.
        // In Node dev (vite dev), undici rejects the Upgrade header, which
        // floods the dev server with errors. Detect non-Worker runtimes and
        // return a no-op SSE stream so the client falls back to REST polling.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isWorker = typeof (globalThis as any).WebSocketPair !== "undefined";
        if (!isWorker) {
          const enc = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(enc.encode(`event: info\ndata: {"mode":"rest-fallback"}\n\n`));
              // Keep the connection alive but quiet; client will use REST polling.
            },
          });
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              "Connection": "keep-alive",
              "X-Accel-Buffering": "no",
            },
          });
        }

        // Cloudflare Workers WebSocket client: fetch with Upgrade header.
        const upstream = await fetch(ALPACA_WS, {
          headers: { Upgrade: "websocket" },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ws = (upstream as any).webSocket as WebSocket | undefined;
        if (!ws) {
          return new Response("Upstream WS upgrade failed", { status: 502 });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ws as any).accept?.();

        const enc = new TextEncoder();
        let heartbeat: ReturnType<typeof setInterval> | undefined;

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (event: string, data: unknown) => {
              try {
                controller.enqueue(
                  enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
                );
              } catch {
                /* closed */
              }
            };

            ws.addEventListener("message", (ev: MessageEvent) => {
              try {
                const raw = typeof ev.data === "string"
                  ? ev.data
                  : new TextDecoder().decode(ev.data as ArrayBuffer);
                const msgs = JSON.parse(raw);
                if (!Array.isArray(msgs)) return;
                for (const m of msgs) {
                  if (m.T === "success" && m.msg === "connected") {
                    ws.send(JSON.stringify({ action: "auth", key, secret }));
                  } else if (m.T === "success" && m.msg === "authenticated") {
                    ws.send(
                      JSON.stringify({
                        action: "subscribe",
                        trades: TICKERS,
                        quotes: TICKERS,
                      })
                    );
                    send("ready", { tickers: TICKERS });
                  } else if (m.T === "q") {
                    // Quote: bid (bp) / ask (ap)
                    send("quote", {
                      ticker: m.S,
                      bid: m.bp,
                      ask: m.ap,
                      ts: m.t,
                    });
                  } else if (m.T === "t") {
                    // Trade: last price
                    send("trade", {
                      ticker: m.S,
                      price: m.p,
                      size: m.s,
                      ts: m.t,
                    });
                  } else if (m.T === "error") {
                    send("alpaca_error", m);
                  }
                }
              } catch (e) {
                send("error", { message: (e as Error).message });
              }
            });

            ws.addEventListener("close", () => {
              if (heartbeat) clearInterval(heartbeat);
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            });
            ws.addEventListener("error", () => {
              send("error", { message: "Upstream WS error" });
            });

            // SSE heartbeat to keep proxies/CF from closing the stream.
            heartbeat = setInterval(() => {
              try {
                controller.enqueue(enc.encode(`: ping\n\n`));
              } catch {
                if (heartbeat) clearInterval(heartbeat);
              }
            }, 15000);
          },
          cancel() {
            if (heartbeat) clearInterval(heartbeat);
            try {
              ws.close();
            } catch {
              /* noop */
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
