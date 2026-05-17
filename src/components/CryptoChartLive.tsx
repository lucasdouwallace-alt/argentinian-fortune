import { useCallback, useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCryptoBars } from "@/lib/crypto.functions";

type Tf = "1Hour" | "4Hour" | "1Day" | "1Week";
type Bar = { t: string; o: number; h: number; l: number; c: number; v: number };

const TF_LABEL: Record<Tf, string> = { "1Hour": "1H", "4Hour": "4H", "1Day": "1D", "1Week": "1W" };
const TF_LIMIT: Record<Tf, number> = { "1Hour": 60, "4Hour": 60, "1Day": 60, "1Week": 52 };
const W = 600; const H = 240;
const PAD = { top: 10, right: 68, bottom: 26, left: 6 };

function fmt(iso: string, tf: Tf) {
  const d = new Date(iso);
  return tf === "1Hour" || tf === "4Hour"
    ? d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function usdC(v: number) {
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(6)}`;
}

function CandlestickSVG({ bars, tf }: { bars: Bar[]; tf: Tf }) {
  if (!bars.length) return null;
  const prices = bars.flatMap((b) => [b.h, b.l]);
  const lo = Math.min(...prices) * 0.995;
  const hi = Math.max(...prices) * 1.005;
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;
  const toX = (i: number) => PAD.left + (i + 0.5) * (cW / bars.length);
  const toY = (p: number) => PAD.top + cH - ((p - lo) / (hi - lo)) * cH;
  const candleW = Math.max(2, Math.min(12, cW / bars.length - 2));
  const xStep = Math.ceil(bars.length / 5);
  const yStep = (hi - lo) / 5;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" style={{ display: "block" }}>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const price = lo + i * yStep;
        const y = toY(price);
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            <text x={W - PAD.right + 4} y={y + 4} fontSize={9} fill="rgba(160,160,180,0.9)">{usdC(price)}</text>
          </g>
        );
      })}
      {bars.map((b, i) =>
        i % xStep !== 0 ? null : (
          <text key={i} x={toX(i)} y={H - 4} fontSize={9} fill="rgba(160,160,180,0.7)" textAnchor="middle">
            {fmt(b.t, tf)}
          </text>
        )
      )}
      {bars.map((b, i) => {
        const x = toX(i);
        const up = b.c >= b.o;
        const col = up ? "#22c55e" : "#ef4444";
        const bodyTop = toY(Math.max(b.o, b.c));
        const bodyBot = toY(Math.min(b.o, b.c));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        const wickTop = toY(b.h);
        const wickBot = toY(b.l);
        return (
          <g key={i}>
            <line x1={x} y1={wickTop} x2={x} y2={wickBot} stroke={col} strokeWidth={1} opacity={0.8} />
            <rect x={x - candleW / 2} y={bodyTop} width={candleW} height={bodyH} fill={col} fillOpacity={0.85} stroke={col} strokeWidth={0.5} />
          </g>
        );
      })}
    </svg>
  );
}

export function CryptoChartLive({ symbol }: { symbol: string }) {
  const [tf, setTf] = useState<Tf>("1Hour");
  const [bars, setBars] = useState<Bar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetch = useRef<string>("");

  const fetchBars = useServerFn(getCryptoBars);

  const load = useCallback(
    async (nextTf: Tf) => {
      const cacheKey = `${symbol}:${nextTf}`;
      if (lastFetch.current === cacheKey && bars.length > 0) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetchBars({ data: { symbol, timeframe: nextTf, limit: TF_LIMIT[nextTf] } });
        setBars(res.bars as Bar[]);
        lastFetch.current = cacheKey;
      } catch (e) {
        setError("Error al cargar el gráfico");
        console.error("[CryptoChartLive]", e);
      } finally {
        setLoading(false);
      }
    },
    [symbol, bars.length, fetchBars]
  );

  const [initialized, setInitialized] = useState(false);
  if (!initialized) {
    setInitialized(true);
    load(tf);
  }

  const handleTf = (newTf: Tf) => {
    setTf(newTf);
    lastFetch.current = "";
    load(newTf);
  };

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex gap-1">
        {(Object.keys(TF_LABEL) as Tf[]).map((t) => (
          <button
            key={t}
            onClick={() => handleTf(t)}
            className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${
              tf === t ? "bg-green-500 text-black" : "bg-white/10 text-white/60 hover:bg-white/20"
            }`}
          >
            {TF_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="w-full bg-white/5 rounded-lg overflow-hidden" style={{ height: 240 }}>
        {loading && <div className="w-full h-full flex items-center justify-center text-white/40 text-sm">Cargando velas...</div>}
        {!loading && error && <div className="w-full h-full flex items-center justify-center text-red-400 text-sm">{error}</div>}
        {!loading && !error && bars.length === 0 && <div className="w-full h-full flex items-center justify-center text-white/40 text-sm">Sin datos de gráfico</div>}
        {!loading && !error && bars.length > 0 && <CandlestickSVG bars={bars} tf={tf} />}
      </div>
    </div>
  );
}
