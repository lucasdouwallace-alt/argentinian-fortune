import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getMarketSnapshot, type MarketSnapshot } from "@/lib/prices.functions";
import { analyzeMarket, type MarketAnalysis } from "@/lib/analyze.functions";
import { openPosition, closePosition } from "@/lib/positions.functions";
import { chatWithOraculo } from "@/lib/chat.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { usd, ars, pct, timeAgo } from "@/lib/format";
import { toast } from "sonner";
import { Sparkles, RefreshCw, LogOut, Brain, TrendingUp, TrendingDown, Minus, AlertTriangle, ShoppingCart, X, Bell, MessageSquare, History, Send, Search } from "lucide-react";

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

type Position = {
  id: string;
  ticker: string;
  quantity: number;
  entry_price_usd: number;
  entry_date: string;
  mep_at_entry: number | null;
};

type HistoryRow = {
  id: string;
  ticker: string;
  quantity: number;
  entry_price_usd: number;
  entry_date: string;
  exit_price_usd: number | null;
  exit_date: string | null;
  status: string;
  pnl_usd: number | null;
  pnl_pct: number | null;
};

type ChatMsg = { role: "user" | "assistant"; content: string };

function signalColor(s: string) {
  if (s === "COMPRAR") return "bg-success/15 text-success border-success/30";
  if (s === "VENDER") return "bg-destructive/15 text-destructive border-destructive/30";
  if (s === "MANTENER") return "bg-info/15 text-info border-info/30";
  return "bg-muted text-muted-foreground border-border";
}

function Dashboard() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const fetchSnapshot = useServerFn(getMarketSnapshot);
  const fetchAnalysis = useServerFn(analyzeMarket);
  const fnOpenPosition = useServerFn(openPosition);
  const fnClosePosition = useServerFn(closePosition);
  const fnChat = useServerFn(chatWithOraculo);

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

  const loadPositions = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("positions")
      .select("id, ticker, quantity, entry_price_usd, entry_date, mep_at_entry")
      .eq("user_id", user.id)
      .eq("status", "open")
      .order("entry_date", { ascending: false });
    setPositions((data || []) as Position[]);
  }, [user]);

  useEffect(() => { loadPositions(); }, [loadPositions]);

  const handleConfirmBuy = async () => {
    if (!buyDialog) return;
    const qty = Number(buyDialog.qty);
    if (!Number.isFinite(qty) || qty <= 0) { toast.error("Cantidad inválida"); return; }
    setSubmittingTrade(true);
    try {
      const res = await fnOpenPosition({ data: { ticker: buyDialog.ticker, quantity: qty } });
      toast.success(`Comprado ${res.quantity} ${res.ticker} @ ${usd(res.entry_price_usd)}`);
      setBuyDialog(null);
      await loadPositions();
    } catch (e) {
      toast.error("Error: " + (e as Error).message);
    } finally { setSubmittingTrade(false); }
  };

  const handleClose = async (id: string, ticker: string) => {
    setClosingId(id);
    try {
      const res = await fnClosePosition({ data: { id } });
      const sign = res.pnl_usd >= 0 ? "+" : "";
      toast.success(`Cerrado ${ticker} @ ${usd(res.exit_price_usd)} · P&L ${sign}${usd(res.pnl_usd)} (${pct(res.pnl_pct)})`);
      await loadPositions();
    } catch (e) {
      toast.error("Error: " + (e as Error).message);
    } finally { setClosingId(null); }
  };

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
    } finally { setLoadingSnap(false); }
  }, [fetchSnapshot, snapshot]);

  useEffect(() => {
    if (!user) return;
    refreshSnap();
    const id = setInterval(refreshSnap, 30000);
    return () => clearInterval(id);
  }, [user, refreshSnap]);

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
      try { const d = JSON.parse(ev.data); applyPrice(d.ticker, d.price, d.ts); } catch {/* noop */}
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
    } finally { setLoadingAi(false); }
  };

  const totalCapitalUsd = snapshot?.mep ? (profile?.monthly_capital_ars || 0) / snapshot.mep : 0;
  const aiByTicker = new Map(analysis?.assets.map(a => [a.ticker, a]) || []);
  const priceByTicker = useMemo(
    () => new Map((snapshot?.quotes || []).map(q => [q.ticker, q.price_usd])),
    [snapshot]
  );
  const positionsLive = useMemo(() => positions.map(p => {
    const cur = priceByTicker.get(p.ticker) || 0;
    const pnl_usd = cur ? (cur - Number(p.entry_price_usd)) * Number(p.quantity) : 0;
    const pnl_pct = cur ? (cur / Number(p.entry_price_usd) - 1) * 100 : 0;
    return { ...p, current_price_usd: cur, pnl_usd, pnl_pct };
  }), [positions, priceByTicker]);
  const totalPnlUsd = positionsLive.reduce((a, p) => a + (p.current_price_usd ? p.pnl_usd : 0), 0);
  const totalCostUsd = positionsLive.reduce((a, p) => a + Number(p.entry_price_usd) * Number(p.quantity), 0);
  const totalPnlPct = totalCostUsd ? (totalPnlUsd / totalCostUsd) * 100 : 0;

  // --- Alerts (SL/TP automatic per open position) ---
  const assetByTicker = useMemo(() => new Map(assets.map(a => [a.ticker, a])), [assets]);
  const alerts = useMemo(() => {
    const list: Array<{
      id: string; ticker: string; kind: "TP" | "SL" | "OK";
      entry: number; current: number; pnl_pct: number;
      threshold_pct: number; distance_pct: number;
    }> = [];
    for (const p of positionsLive) {
      const cfg = assetByTicker.get(p.ticker);
      if (!cfg || !p.current_price_usd) continue;
      const change = p.pnl_pct;
      let kind: "TP" | "SL" | "OK" = "OK";
      let threshold = 0;
      if (change >= cfg.tp_pct) { kind = "TP"; threshold = cfg.tp_pct; }
      else if (change <= -cfg.sl_pct) { kind = "SL"; threshold = -cfg.sl_pct; }
      else {
        // distance to nearest threshold
        const dTp = cfg.tp_pct - change;
        const dSl = change + cfg.sl_pct;
        threshold = dTp < dSl ? cfg.tp_pct : -cfg.sl_pct;
      }
      const distance = threshold - change;
      list.push({
        id: p.id, ticker: p.ticker, kind,
        entry: Number(p.entry_price_usd), current: p.current_price_usd,
        pnl_pct: change, threshold_pct: threshold, distance_pct: distance,
      });
    }
    // triggered first
    list.sort((a, b) => (a.kind === "OK" ? 1 : 0) - (b.kind === "OK" ? 1 : 0));
    return list;
  }, [positionsLive, assetByTicker]);

  const triggeredCount = alerts.filter(a => a.kind !== "OK").length;
  // notify on new triggers
  const notifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const a of alerts) {
      const key = `${a.id}:${a.kind}`;
      if (a.kind !== "OK" && !notifiedRef.current.has(key)) {
        notifiedRef.current.add(key);
        if (a.kind === "TP") toast.success(`🎯 TP alcanzado en ${a.ticker} (+${a.pnl_pct.toFixed(2)}%)`);
        else toast.error(`🛑 SL gatillado en ${a.ticker} (${a.pnl_pct.toFixed(2)}%)`);
      }
    }
  }, [alerts]);

  // --- History ---
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [histSearch, setHistSearch] = useState("");
  const [histFrom, setHistFrom] = useState("");
  const [histTo, setHistTo] = useState("");
  const [histStatus, setHistStatus] = useState<"all" | "open" | "closed">("all");
  const loadHistory = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("positions")
      .select("id, ticker, quantity, entry_price_usd, entry_date, exit_price_usd, exit_date, status, pnl_usd, pnl_pct")
      .eq("user_id", user.id)
      .order("entry_date", { ascending: false })
      .limit(500);
    setHistory((data || []) as HistoryRow[]);
  }, [user]);
  useEffect(() => { loadHistory(); }, [loadHistory, positions.length]);

  const filteredHistory = useMemo(() => {
    const q = histSearch.trim().toUpperCase();
    const from = histFrom ? new Date(histFrom).getTime() : 0;
    const to = histTo ? new Date(histTo).getTime() + 86400000 : Infinity;
    return history.filter(h => {
      if (q && !h.ticker.includes(q)) return false;
      if (histStatus !== "all" && h.status !== histStatus) return false;
      const t = new Date(h.entry_date).getTime();
      if (t < from || t > to) return false;
      return true;
    });
  }, [history, histSearch, histFrom, histTo, histStatus]);

  // --- Chat IA ---
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([
    { role: "assistant", content: "Hola 👋 Soy Oráculo. Preguntame sobre tu cartera, MEP/CCL, o cualquier ticker. (No es asesoramiento financiero)" },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMsgs, chatSending]);

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatSending) return;
    const next: ChatMsg[] = [...chatMsgs, { role: "user", content: text }];
    setChatMsgs(next);
    setChatInput("");
    setChatSending(true);
    try {
      const res = await fnChat({
        data: {
          messages: next.slice(-20),
          context: snapshot ? {
            mep: snapshot.mep, ccl: snapshot.ccl,
            quotes: snapshot.quotes.map(q => ({ ticker: q.ticker, price_usd: q.price_usd, change_pct: q.change_pct })),
          } : undefined,
        },
      });
      setChatMsgs(m => [...m, { role: "assistant", content: res.reply }]);
    } catch (e) {
      toast.error("Error chat: " + (e as Error).message);
      setChatMsgs(m => [...m, { role: "assistant", content: "⚠️ " + (e as Error).message }]);
    } finally { setChatSending(false); }
  };

  if (authLoading || !profile) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Cargando...</div>;
  }

  return (
    <div className="min-h-screen bg-glow">
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

        <Tabs defaultValue="cartera" className="w-full">
          <TabsList className="grid grid-cols-4 w-full md:w-auto md:inline-flex">
            <TabsTrigger value="cartera">Cartera</TabsTrigger>
            <TabsTrigger value="alertas" className="gap-1">
              <Bell className="size-3" /> Alertas
              {triggeredCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center text-[10px] font-bold rounded-full bg-destructive text-destructive-foreground size-4">
                  {triggeredCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="chat" className="gap-1"><MessageSquare className="size-3" /> Chat IA</TabsTrigger>
            <TabsTrigger value="historial" className="gap-1"><History className="size-3" /> Historial</TabsTrigger>
          </TabsList>

          {/* CARTERA */}
          <TabsContent value="cartera" className="space-y-6 mt-4">
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
                      <th className="text-right px-4 py-2"></th>
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
                          <td className={`px-4 py-3 text-right font-mono ${flash}`} data-mono>{q?.price_usd ? usd(q.price_usd) : "—"}</td>
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
                                <Badge className={`${signalColor(sig.signal)} border`} variant="outline">{sig.signal} · {sig.confidence}%</Badge>
                                <div className="text-xs text-muted-foreground mt-1 max-w-xs">{sig.action_reason}</div>
                              </div>
                            ) : <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Minus className="size-3" /> Sin análisis</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button size="sm" variant="outline" disabled={!q?.price_usd} onClick={() => setBuyDialog({ ticker: asset.ticker, qty: "1" })}>
                              <ShoppingCart className="size-3 mr-1" /> Comprar
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                    {assets.length === 0 && (
                      <tr><td colSpan={6} className="text-center text-muted-foreground py-8">Sin activos en cartera.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-card border rounded-xl shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
                <h2 className="font-display font-semibold">Posiciones abiertas</h2>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">{positions.length} abiertas</span>
                  {positions.length > 0 && (
                    <span className={`font-mono font-bold ${totalPnlUsd >= 0 ? "text-success" : "text-destructive"}`} data-mono>
                      P&L total: {totalPnlUsd >= 0 ? "+" : ""}{usd(totalPnlUsd)} ({pct(totalPnlPct)})
                    </span>
                  )}
                </div>
              </div>
              {positions.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  Sin posiciones abiertas. Tocá <span className="text-foreground">Comprar</span> en un activo.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground uppercase border-b">
                      <tr>
                        <th className="text-left px-4 py-2">Activo</th>
                        <th className="text-right px-4 py-2">Cant.</th>
                        <th className="text-right px-4 py-2">Entrada</th>
                        <th className="text-right px-4 py-2">Actual</th>
                        <th className="text-right px-4 py-2">P&L USD</th>
                        <th className="text-right px-4 py-2 hidden sm:table-cell">P&L %</th>
                        <th className="text-right px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {positionsLive.map(p => {
                        const positive = p.pnl_usd >= 0;
                        return (
                          <tr key={p.id} className="border-b last:border-0">
                            <td className="px-4 py-3">
                              <div className="font-display font-bold">{p.ticker}</div>
                              <div className="text-xs text-muted-foreground">{timeAgo(p.entry_date)}</div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono" data-mono>{p.quantity}</td>
                            <td className="px-4 py-3 text-right font-mono text-muted-foreground" data-mono>{usd(Number(p.entry_price_usd))}</td>
                            <td className="px-4 py-3 text-right font-mono" data-mono>{p.current_price_usd ? usd(p.current_price_usd) : "—"}</td>
                            <td className={`px-4 py-3 text-right font-mono ${positive ? "text-success" : "text-destructive"}`} data-mono>
                              {p.current_price_usd ? `${positive ? "+" : ""}${usd(p.pnl_usd)}` : "—"}
                            </td>
                            <td className={`px-4 py-3 text-right font-mono hidden sm:table-cell ${positive ? "text-success" : "text-destructive"}`} data-mono>
                              {p.current_price_usd ? pct(p.pnl_pct) : "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button size="sm" variant="outline" disabled={closingId === p.id} onClick={() => handleClose(p.id, p.ticker)}>
                                <X className="size-3 mr-1" />
                                {closingId === p.id ? "Cerrando..." : "Cerrar"}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </TabsContent>

          {/* ALERTAS */}
          <TabsContent value="alertas" className="mt-4">
            <section className="bg-card border rounded-xl shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <div>
                  <h2 className="font-display font-semibold flex items-center gap-2">
                    <Bell className="size-4 text-primary" /> Alertas SL/TP
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Monitoreo automático en tiempo real. Stop Loss y Take Profit por activo (configurado en cartera).
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">{triggeredCount} gatilladas</span>
              </div>
              {alerts.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-10">
                  Sin posiciones abiertas para monitorear.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground uppercase border-b">
                      <tr>
                        <th className="text-left px-4 py-2">Activo</th>
                        <th className="text-left px-4 py-2">Estado</th>
                        <th className="text-right px-4 py-2">Entrada</th>
                        <th className="text-right px-4 py-2">Actual</th>
                        <th className="text-right px-4 py-2">P&L %</th>
                        <th className="text-right px-4 py-2 hidden sm:table-cell">SL / TP</th>
                        <th className="text-right px-4 py-2 hidden md:table-cell">Distancia</th>
                        <th className="text-right px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.map(a => {
                        const cfg = assetByTicker.get(a.ticker);
                        const colorRow =
                          a.kind === "TP" ? "bg-success/10" :
                          a.kind === "SL" ? "bg-destructive/10" : "";
                        return (
                          <tr key={a.id} className={`border-b last:border-0 ${colorRow}`}>
                            <td className="px-4 py-3 font-display font-bold">{a.ticker}</td>
                            <td className="px-4 py-3">
                              {a.kind === "TP" && <Badge className="bg-success/20 text-success border-success/40" variant="outline">🎯 TP gatillado</Badge>}
                              {a.kind === "SL" && <Badge className="bg-destructive/20 text-destructive border-destructive/40" variant="outline">🛑 SL gatillado</Badge>}
                              {a.kind === "OK" && <Badge variant="outline" className="text-muted-foreground">En rango</Badge>}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-muted-foreground" data-mono>{usd(a.entry)}</td>
                            <td className="px-4 py-3 text-right font-mono" data-mono>{usd(a.current)}</td>
                            <td className={`px-4 py-3 text-right font-mono ${a.pnl_pct >= 0 ? "text-success" : "text-destructive"}`} data-mono>
                              {pct(a.pnl_pct)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs hidden sm:table-cell text-muted-foreground" data-mono>
                              {cfg ? `-${cfg.sl_pct}% / +${cfg.tp_pct}%` : "—"}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs hidden md:table-cell text-muted-foreground" data-mono>
                              {a.kind === "OK" ? `${a.distance_pct >= 0 ? "+" : ""}${a.distance_pct.toFixed(2)}%` : "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {a.kind !== "OK" && (
                                <Button size="sm" variant="outline" disabled={closingId === a.id} onClick={() => handleClose(a.id, a.ticker)}>
                                  <X className="size-3 mr-1" />
                                  {closingId === a.id ? "Cerrando..." : "Cerrar"}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </TabsContent>

          {/* CHAT IA */}
          <TabsContent value="chat" className="mt-4">
            <section className="bg-card border rounded-xl shadow-card flex flex-col h-[60vh] min-h-[420px] overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center gap-2">
                <MessageSquare className="size-4 text-primary" />
                <h2 className="font-display font-semibold">Chat con Oráculo IA</h2>
                <span className="ml-auto text-xs text-muted-foreground">Gemini 2.5 Flash · contexto en vivo</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {chatMsgs.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                      m.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
                    }`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {chatSending && (
                  <div className="flex justify-start">
                    <div className="bg-secondary text-secondary-foreground rounded-lg px-3 py-2 text-sm animate-pulse">
                      Oráculo está pensando…
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <form
                className="border-t p-3 flex gap-2"
                onSubmit={(e) => { e.preventDefault(); sendChat(); }}
              >
                <Input
                  placeholder="Preguntá: ¿conviene comprar NVDA hoy?"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={chatSending}
                />
                <Button type="submit" size="sm" disabled={chatSending || !chatInput.trim()}>
                  <Send className="size-4" />
                </Button>
              </form>
            </section>
          </TabsContent>

          {/* HISTORIAL */}
          <TabsContent value="historial" className="mt-4">
            <section className="bg-card border rounded-xl shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b">
                <h2 className="font-display font-semibold flex items-center gap-2">
                  <History className="size-4 text-primary" /> Historial de operaciones
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                  <div className="relative">
                    <Search className="size-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-7 h-8 text-xs" placeholder="Ticker" value={histSearch} onChange={(e) => setHistSearch(e.target.value)} />
                  </div>
                  <Input type="date" className="h-8 text-xs" value={histFrom} onChange={(e) => setHistFrom(e.target.value)} />
                  <Input type="date" className="h-8 text-xs" value={histTo} onChange={(e) => setHistTo(e.target.value)} />
                  <select
                    value={histStatus}
                    onChange={(e) => setHistStatus(e.target.value as "all" | "open" | "closed")}
                    className="h-8 text-xs rounded-md border border-input bg-transparent px-2"
                  >
                    <option value="all">Todas</option>
                    <option value="open">Abiertas</option>
                    <option value="closed">Cerradas</option>
                  </select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground uppercase border-b">
                    <tr>
                      <th className="text-left px-4 py-2">Activo</th>
                      <th className="text-left px-4 py-2 hidden sm:table-cell">Apertura</th>
                      <th className="text-left px-4 py-2 hidden md:table-cell">Cierre</th>
                      <th className="text-right px-4 py-2">Cant.</th>
                      <th className="text-right px-4 py-2">Entrada</th>
                      <th className="text-right px-4 py-2 hidden sm:table-cell">Salida</th>
                      <th className="text-right px-4 py-2">P&L</th>
                      <th className="text-left px-4 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map(h => {
                      const closed = h.status === "closed";
                      const positive = (h.pnl_usd || 0) >= 0;
                      return (
                        <tr key={h.id} className="border-b last:border-0 hover:bg-secondary/30 transition">
                          <td className="px-4 py-3 font-display font-bold">{h.ticker}</td>
                          <td className="px-4 py-3 hidden sm:table-cell text-xs text-muted-foreground">
                            {new Date(h.entry_date).toLocaleDateString("es-AR")}
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                            {h.exit_date ? new Date(h.exit_date).toLocaleDateString("es-AR") : "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono" data-mono>{Number(h.quantity)}</td>
                          <td className="px-4 py-3 text-right font-mono text-muted-foreground" data-mono>{usd(Number(h.entry_price_usd))}</td>
                          <td className="px-4 py-3 text-right font-mono hidden sm:table-cell" data-mono>
                            {h.exit_price_usd ? usd(Number(h.exit_price_usd)) : "—"}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono ${closed ? (positive ? "text-success" : "text-destructive") : "text-muted-foreground"}`} data-mono>
                            {closed && h.pnl_usd != null ? `${positive ? "+" : ""}${usd(Number(h.pnl_usd))} (${pct(Number(h.pnl_pct))})` : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {closed
                              ? <Badge variant="outline" className="text-muted-foreground">Cerrada</Badge>
                              : <Badge variant="outline" className="bg-info/15 text-info border-info/30">Abierta</Badge>}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredHistory.length === 0 && (
                      <tr><td colSpan={8} className="text-center text-muted-foreground py-8">Sin operaciones para el filtro aplicado.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 text-xs text-muted-foreground border-t">
                {filteredHistory.length} de {history.length} operaciones
              </div>
            </section>
          </TabsContent>
        </Tabs>

        <p className="text-xs text-muted-foreground text-center pt-4 pb-8 flex items-center justify-center gap-1">
          <AlertTriangle className="size-3" />
          App educativa · No constituye asesoramiento financiero
        </p>
      </main>

      <Dialog open={!!buyDialog} onOpenChange={(o) => !o && setBuyDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar compra · {buyDialog?.ticker}</DialogTitle>
            <DialogDescription>
              El precio de entrada se toma de Alpaca al momento de confirmar.
              {(() => {
                const live = buyDialog ? priceByTicker.get(buyDialog.ticker) : 0;
                const qty = Number(buyDialog?.qty || 0);
                if (!live) return null;
                const total = live * (Number.isFinite(qty) ? qty : 0);
                return (
                  <span className="block mt-2 text-foreground">
                    Precio actual: <span className="font-mono">{usd(live)}</span> · Total estimado:{" "}
                    <span className="font-mono">{usd(total)}</span>
                    {snapshot?.mep ? <span className="text-muted-foreground"> ({ars(total * snapshot.mep)})</span> : null}
                  </span>
                );
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="qty">Cantidad</Label>
            <Input
              id="qty"
              type="number"
              min="0"
              step="0.0001"
              value={buyDialog?.qty || ""}
              onChange={(e) => setBuyDialog(d => d ? { ...d, qty: e.target.value } : d)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBuyDialog(null)} disabled={submittingTrade}>Cancelar</Button>
            <Button onClick={handleConfirmBuy} disabled={submittingTrade}>
              {submittingTrade ? "Comprando..." : "Confirmar compra"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
