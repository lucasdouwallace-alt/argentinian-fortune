import { useEffect, useCallback, useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCryptoBars } from "@/lib/crypto.functions";

type Tf = "1Hour" | "4Hour" | "1Day" | "1Week";
type Bar = { t: string; o: number; h: number; l: number; c: number; v: number };

const TF_LABEL: Record<Tf, string> = { "1Hour": "1H", "4Hour": "4H", "1Day": "1D", "1Week": "1W" };
const TF_LIMIT: Record<Tf, number> = { "1Hour": 60, "4Hour": 60, "1Day": 60, "1Week": 52 };
const TF_REFRESH_MS: Record<Tf, number> = { "1Hour": 30_000, "4Hour": 180_000, "1Day": 600_000, "1Week": 3600_000 };
const W = 600; const H = 260;
const PAD = { top: 12, right: 70, bottom: 28, left: 8 };

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
      {[0,1,2,3,4,5].map((i) => { const y = toY(lo + i * yStep); return (
        <g key={i}>
          <line x1={PAD.left} y1={y} x2={W-PAD.right} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={1}/>
          <text x={W-PAD.right+4} y={y+4} fontSize={9} fill="rgba(160,160,180,0.8)">{usdC(lo + i * yStep)}</text>
        </g>
      );})}
      {bars.map((b, i) => i % xStep === 0 ? (
        <text key={i} x={toX(i)} y={H-6} fontSize={9} fill="rgba(160,160,180,0.7)" textAnchor="middle">{fmt(b.t, tf)}</text>
      ) : null)}
      {bars.map((b, i) => {
        const x = toX(i); const up = b.c >= b.o; const col = up ? "#22c55e" : "#ef4444";
        const bTop = toY(Math.max(b.o, b.c)); const bBot = toY(Math.min(b.o, b.c));
        return (
          <g key={i}>
            <line x1={x} y1={toY(b.h)} x2={x} y2={toY(b.l)} stroke={col} strokeWidth={1}/>
            <rect x={x - candleW/2} y={bTop} width={candleW} height={Math.max(1, bBot-bTop)} fill={col} rx={1}/>
          </g>
        );
      })}
      {(() => { const b = bars[bars.length-1]; const py = toY(b.c); return (
        <g>
          <line x1={PAD.left} y1={py} x2={W-PAD.right} y2={py} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="3 3"/>
          <rect x={W-PAD.right+3} y={py-8} width={62} height={16} fill={b.c>=b.o?"#22c55e":"#ef4444"} rx={3}/>
          <text x={W-PAD.right+34} y={py+4} fontSize={9} fill="white" textAnchor="middle" fontWeight="bold">{usdC(b.c)}</text>
        </g>
      );})()}
    </svg>
  );
}

export function CryptoChartLive({ symbol, ticker }: { symbol: string; ticker: string }) {
  const fetchBars = useServerFn(getCryptoBars);
  // FIX: guardar en ref para evitar loop infinito
  const fetchRef = useRef(fetchBars);
  useEffect(() => { fetchRef.current = fetchBars; });

  const [tf, setTf] = useState<Tf>("1Hour");
  const [bars, setBars] = useState<Bar[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  // fetchBars NO está en deps — usamos ref para evitar el loop
  const loadBars = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const { bars: raw } = await fetchRef.current({ data: { symbol, timeframe: tf, limit: TF_LIMIT[tf] } });
      const valid = raw.filter((b) => b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0);
      setBars((prev) => {
        if (isRefresh && prev.length && valid.length) {
          const u = [...prev]; u[u.length-1] = valid[valid.length-1]; return u;
        }
        return valid;
      });
      setLastUpdate(new Date());
    } catch (e) { console.error("[chart]", e); }
    finally { setLoading(false); }
  }, [symbol, tf]); // solo symbol y tf — sin fetchBars

  useEffect(() => { loadBars(false); }, [loadBars]);
  useEffect(() => {
    const id = setInterval(() => loadBars(true), TF_REFRESH_MS[tf]);
    return () => clearInterval(id);
  }, [tf, loadBars]);

  return (
    <div className="bg-secondary/20 border rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm">{ticker}/USD</span>
          <span className="text-xs text-muted-foreground">{loading ? "Cargando…" : `${bars.length} velas · ${TF_LABEL[tf]}`}</span>
          {lastUpdate && (
            <span className="text-xs text-success inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-success animate-pulse inline-block"/>
              {lastUpdate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {(Object.keys(TF_LABEL) as Tf[]).map((t) => (
            <button key={t} onClick={() => setTf(t)}
              className={`px-2 py-0.5 rounded text-xs font-mono ${tf===t ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-muted-foreground hover:bg-secondary"}`}>
              {TF_LABEL[t]}
            </button>
          ))}
          <button onClick={() => loadBars(false)} className="px-2 py-0.5 rounded text-xs bg-secondary/60 text-muted-foreground hover:bg-secondary">↺</button>
        </div>
      </div>
      <div className="relative w-full" style={{ height: 260 }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-card/50 rounded">
            <span className="size-3 rounded-full border-2 border-primary border-t-transparent animate-spin inline-block mr-2"/>
            <span className="text-xs text-muted-foreground">Cargando velas…</span>
          </div>
        )}
        {!loading && !bars.length && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Sin datos</div>
        )}
        <CandlestickSVG bars={bars} tf={tf}/>
      </div>
    </div>
  );
}
