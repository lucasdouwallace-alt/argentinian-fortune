import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getMarketSnapshot, type MarketSnapshot } from "@/lib/prices.functions";
import { analyzeMarket, type MarketAnalysis } from "@/lib/analyze.functions";
import { openPosition, closePosition } from "@/lib/positions.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { usd, ars, pct, timeAgo } from "@/lib/format";
import { toast } from "sonner";
import { Sparkles, RefreshCw, LogOut, Brain, TrendingUp, TrendingDown, Minus, AlertTriangle, ShoppingCart, X } from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · Oráculo" }] }),
  component: Dashboard,
});

type Profile = {
  name: string | null;
  monthly_capital_ars: number;
  onboarding_completed: boolean;
};

type Asset = {
  id: string;
  ticker: string;
  name: string;
  tipo: string | null;
  pct_allocation: number;
  sl_pct: number;
  tp_pct: number;
};

function signalColor(s: string) {
  if (s === "COMPRAR") return "bg-success/15 text-success border-success/30";
  if (s === "VENDER") return "bg-destructive/15 text-destructive border-destructive/30";
  if (s === "MANTENER") return "bg-info/15 text-info border-info/30";
  return "bg-muted text-muted-foreground border-border";
}

type Position = {
  id: string;
  ticker: string;
  quantity: number;
  entry_price_usd: number;
  entry_date: string;
  mep_at_entry: number | null;
};

function Dashboard() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const fetchSnapshot = useServerFn(getMarketSnapshot);
  const fetchAnalysis = useServerFn(analyzeMarket);
  const fnOpenPosition = useServerFn(openPosition);
  const fnClosePosition = useServerFn(closePosition);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [loadingSnap, setLoadingSnap] = useState(false);
  const [loadingAi, setLoadingAi] = useState(false);
  const [prevPrices, setPrevPrices] = useState<Record<string, number>>({});
  const [buyDialog, setBuyDialog] = useState<{ ticker: string; qty: string } | null>(null);
  const [submittingTrade, setSubmittingTrade] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  // auth gate
  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth" });
  }, [authLoading, user, navigate]);

  // load profile + portfolio
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase.from("profiles").select("name, monthly_capital_ars, onboarding_completed").eq("id", user.id).maybeSingle();
      if (!p?.onboarding_completed) {
        navigate({ to: "/onboarding" });
        return;
      }
      setProfile(p as Profile);
      const { data: a } = await supabase.from("portfolio_assets").select("*").eq("user_id", user.id).eq("is_active", true).order("pct_allocation", { ascending: false });
      setAssets((a || []) as Asset[]);
    })();
  }, [user, navigate]);

  const refreshSnap = useCallback(async () => {
    setLoadingSnap(true);
    try {
      const s = await fetchSnapshot();
      setPrevPrices(prev => {
        const old: Record<string, number> = { ...prev };
        snapshot?.quotes.forEach(q => { old[q.ticker] = q.price_usd; });
        return old;
      });
      setSnapshot(s);
    } catch (e) {
      toast.error("Error trayendo precios: " + (e as Error).message);
    } finally {
      setLoadingSnap(false);
    }
  }, [fetchSnapshot, snapshot]);

  // initial + 30s polling fallback (REST)
  useEffect(() => {
    if (!user) return;
    refreshSnap();
    const id = setInterval(refreshSnap, 30000);
    return () => clearInterval(id);
  }, [user, refreshSnap]);

  // Live stream via SSE proxying Alpaca WebSocket
  const [streamLive, setStreamLive] = useState(false);
  useEffect(() => {
    if (!user) return;
    const es = new EventSource("/api/stream/prices");
    es.addEventListener("ready", () => setStreamLive(true));
    const applyPrice = (ticker: string, price: number, ts: string) => {
      if (!price || price <= 0) return;
      setSnapshot(prev => {
        if (!prev) return prev;
        const quotes = prev.quotes.map(q => {
          if (q.ticker !== ticker) return q;
          setPrevPrices(pp => ({ ...pp, [ticker]: q.price_usd }));
          return { ...q, price_usd: price, ts };
        });
        return { ...prev, quotes, fx_updated_at: ts };
      });
    };
    es.addEventListener("trade", (ev: MessageEvent) => {
      try {
        const d = JSON.parse(ev.data);
        applyPrice(d.ticker, d.price, d.ts);
      } catch {/* noop */}
    });
    es.addEventListener("quote", (ev: MessageEvent) => {
      try {
        const d = JSON.parse(ev.data);
        const mid = d.bid && d.ask ? (d.bid + d.ask) / 2 : d.ask || d.bid;
        applyPrice(d.ticker, mid, d.ts);
      } catch {/* noop */}
    });
    es.onerror = () => setStreamLive(false);
    return () => { es.close(); setStreamLive(false); };
  }, [user]);

  const runAnalysis = async () => {
    if (!snapshot || !profile) return;
    setLoadingAi(true);
    try {
      const a = await fetchAnalysis({
        data: {
          capital_ars: profile.monthly_capital_ars,
          mep: snapshot.mep,
          ccl: snapshot.ccl,
          quotes: snapshot.quotes.map(q => ({ ticker: q.ticker, price_usd: q.price_usd, change_pct: q.change_pct })),
          positions: [],
        },
      });
      setAnalysis(a);
      toast.success("Análisis IA actualizado");
    } catch (e) {
      toast.error("Error IA: " + (e as Error).message);
    } finally {
      setLoadingAi(false);
    }
  };

  if (authLoading || !profile) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Cargando...</div>;
  }

  const totalCapitalUsd = snapshot?.mep ? profile.monthly_capital_ars / snapshot.mep : 0;
  const aiByTicker = new Map(analysis?.assets.map(a => [a.ticker, a]) || []);

  return (
    <div className="min-h-screen bg-glow">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
          <Link to="/dashboard" className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <span className="font-display font-bold">Oráculo</span>
          </Link>
          <span className={`text-xs ${streamLive || snapshot?.is_open ? "pulse-dot text-success" : "text-muted-foreground"}`}>
            {streamLive ? "LIVE · stream" : snapshot?.is_open ? "LIVE" : "Mercado cerrado"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">Hola, {profile.name}</span>
            <Button size="sm" variant="ghost" onClick={() => signOut().then(() => navigate({ to: "/auth" }))}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 space-y-6">
        {/* Metrics */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Capital mensual" value={ars(profile.monthly_capital_ars)} sub={`≈ ${usd(totalCapitalUsd)}`} />
          <MetricCard label="MEP" value={snapshot?.mep ? ars(snapshot.mep) : "—"} sub="ArgentinaDatos" />
          <MetricCard label="CCL" value={snapshot?.ccl ? ars(snapshot.ccl) : "—"} sub={snapshot ? timeAgo(snapshot.fx_updated_at) : ""} />
          <MetricCard
            label="Score IA"
            value={analysis ? `${Math.round(analysis.market_score)}/100` : "—"}
            sub={analysis?.market_score_label || "Pendiente"}
            highlight
          />
        </section>

        {/* AI context */}
        {analysis && (
          <section className="bg-card border rounded-xl p-4 shadow-card">
            <div className="flex items-start gap-3">
              <Brain className="size-5 text-info shrink-0 mt-0.5" />
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Contexto del mercado hoy</div>
                <p className="text-sm leading-relaxed">{analysis.market_context}</p>
                <div className="text-xs text-muted-foreground mt-2">
                  Retorno mensual estimado: <span className="text-foreground font-medium">{pct(analysis.estimated_monthly_return_pct)}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <Button onClick={refreshSnap} disabled={loadingSnap} variant="outline" size="sm">
            <RefreshCw className={`size-4 mr-2 ${loadingSnap ? "animate-spin" : ""}`} />
            Refrescar precios
          </Button>
          <Button onClick={runAnalysis} disabled={loadingAi || !snapshot} size="sm">
            <Brain className={`size-4 mr-2 ${loadingAi ? "animate-pulse" : ""}`} />
            {loadingAi ? "Analizando..." : "Analizar con IA"}
          </Button>
          {snapshot && (
            <span className="text-xs text-muted-foreground self-center ml-auto">
              Precios {timeAgo(snapshot.fx_updated_at)} · {streamLive ? "WS Alpaca" : snapshot.is_open ? "REST" : "Último cierre"}
            </span>
          )}
        </div>

        {/* Portfolio table */}
        <section className="bg-card border rounded-xl shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="font-display font-semibold">Mi cartera</h2>
            <span className="text-xs text-muted-foreground">{assets.length} activos</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase border-b">
                <tr>
                  <th className="text-left px-4 py-2">Activo</th>
                  <th className="text-right px-4 py-2">Precio USD</th>
                  <th className="text-right px-4 py-2 hidden sm:table-cell">Precio ARS</th>
                  <th className="text-right px-4 py-2">Día</th>
                  <th className="text-left px-4 py-2 hidden md:table-cell">Señal IA</th>
                </tr>
              </thead>
              <tbody>
                {assets.map(asset => {
                  const q = snapshot?.quotes.find(x => x.ticker === asset.ticker);
                  const priceArs = q && snapshot?.ccl ? q.price_usd * snapshot.ccl : 0;
                  const prev = prevPrices[asset.ticker];
                  const flash = prev && q ? (q.price_usd > prev ? "flash-up" : q.price_usd < prev ? "flash-down" : "") : "";
                  const sig = aiByTicker.get(asset.ticker);
                  return (
                    <tr key={asset.id} className="border-b last:border-0 hover:bg-secondary/30 transition">
                      <td className="px-4 py-3">
                        <div className="font-display font-bold">{asset.ticker}</div>
                        <div className="text-xs text-muted-foreground">{asset.name} · {asset.pct_allocation}%</div>
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${flash}`} data-mono>
                        {q?.price_usd ? usd(q.price_usd) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono hidden sm:table-cell text-muted-foreground" data-mono>
                        {priceArs ? ars(priceArs) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono" data-mono>
                        {q ? (
                          <span className={`inline-flex items-center gap-1 ${q.change_pct >= 0 ? "text-success" : "text-destructive"}`}>
                            {q.change_pct >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                            {pct(q.change_pct)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {sig ? (
                          <div>
                            <Badge className={`${signalColor(sig.signal)} border`} variant="outline">
                              {sig.signal} · {sig.confidence}%
                            </Badge>
                            <div className="text-xs text-muted-foreground mt-1 max-w-xs">{sig.action_reason}</div>
                          </div>
                        ) : <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Minus className="size-3" /> Sin análisis</span>}
                      </td>
                    </tr>
                  );
                })}
                {assets.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-muted-foreground py-8">Sin activos en cartera.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-xs text-muted-foreground text-center pt-4 pb-8 flex items-center justify-center gap-1">
          <AlertTriangle className="size-3" />
          App educativa · No constituye asesoramiento financiero
        </p>
      </main>
    </div>
  );
}

function MetricCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`bg-card border rounded-xl p-4 shadow-card ${highlight ? "border-primary/40 shadow-glow" : ""}`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl md:text-2xl font-display font-bold mt-1" data-mono>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
