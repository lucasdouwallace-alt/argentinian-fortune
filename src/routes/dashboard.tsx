import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getMarketSnapshot, type MarketSnapshot } from "@/lib/prices.functions";
import { analyzeMarket, type MarketAnalysis, type AssetSignal } from "@/lib/analyze.functions";
import { closePosition } from "@/lib/positions.functions";
import { chatWithOraculo } from "@/lib/chat.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { usd, ars, pct, timeAgo } from "@/lib/format";
import { toast } from "sonner";
import {
  Sparkles, RefreshCw, LogOut, Brain, TrendingUp, TrendingDown, AlertTriangle,
  X, Bell, MessageSquare, History, Send, Search, ArrowUp, ArrowDown, Pause, ArrowRight, Target,
} from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · Oráculo" }] }),
  component: Dashboard,
});

type Profile = { name: string | null; monthly_capital_ars: number; onboarding_completed: boolean };
type Asset = { id: string; ticker: string; name: string; tipo: string | null; pct_allocation: number; sl_pct: number; tp_pct: number };
type Position = { id: string; ticker: string; quantity: number; entry_price_usd: number; entry_date: string; mep_at_entry: number | null };
type HistoryRow = {
  id: string; ticker: string; quantity: number; entry_price_usd: number; entry_date: string;
  exit_price_usd: number | null; exit_date: string | null; status: string; pnl_usd: number | null; pnl_pct: number | null;
};
type ChatMsg = { role: "user" | "assistant"; content: string };

const TICKER_NAMES: Record<string, string> = {
  VIST: "Vista Energy", MELI: "MercadoLibre", NVDA: "NVIDIA", BMA: "Banco Macro",
  PLTR: "Palantir", GOOGL: "Alphabet", AAPL: "Apple", MSFT: "Microsoft",
  GGAL: "Grupo Galicia", YPF: "YPF",
};

const ANALYSIS_INTERVAL_MIN = 5;

function SignalPill({ signal, large = false }: { signal: AssetSignal["signal"] | string; large?: boolean }) {
  const cfg = {
    COMPRAR: { cls: "bg-success/20 text-success border-success/40", icon: <ArrowUp className="size-3.5" /> },
    VENDER: { cls: "bg-destructive/20 text-destructive border-destructive/40", icon: <ArrowDown className="size-3.5" /> },
    ESPERAR: { cls: "bg-warning/20 text-warning border-warning/40", icon: <Pause className="size-3.5" /> },
    MANTENER: { cls: "bg-info/20 text-info border-info/40", icon: <ArrowRight className="size-3.5" /> },
  }[signal as "COMPRAR"] || { cls: "bg-muted text-muted-foreground border-border", icon: <ArrowRight className="size-3.5" /> };
  return (
    <span className={`inline-flex items-center gap-1.5 border rounded-full font-bold uppercase tracking-wide ${cfg.cls} ${large ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs"}`}>
      {cfg.icon}{signal}
    </span>
  );
}

function riskColor(r?: string) {
  if (r === "Bajo") return "text-success";
  if (r === "Alto") return "text-destructive";
  return "text-warning";
}

function bannerBg(s?: string) {
  if (s === "COMPRAR") return "from-success/20 via-success/5 to-transparent border-success/30";
  if (s === "VENDER") return "from-destructive/20 via-destructive/5 to-transparent border-destructive/30";
  if (s === "ESPERAR") return "from-warning/20 via-warning/5 to-transparent border-warning/30";
  return "from-muted via-muted/30 to-transparent border-border";
}

function Dashboard() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const fetchSnapshot = useServerFn(getMarketSnapshot);
  const fetchAnalysis = useServerFn(analyzeMarket);
  const fnClosePosition = useServerFn(closePosition);
  const fnChat = useServerFn(chatWithOraculo);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [analysisAt, setAnalysisAt] = useState<number | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // ticking clock for "hace X min"
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);

  // auth gate
  useEffect(() => { if (!authLoading && !user) navigate({ to: "/auth" }); }, [authLoading, user, navigate]);

  // load profile + portfolio
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase.from("profiles").select("name, monthly_capital_ars, onboarding_completed").eq("id", user.id).maybeSingle();
      if (!p?.onboarding_completed) { navigate({ to: "/onboarding" }); return; }
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
      .eq("user_id", user.id).eq("status", "open").order("entry_date", { ascending: false });
    setPositions((data || []) as Position[]);
  }, [user]);
  useEffect(() => { loadPositions(); }, [loadPositions]);

  const handleClose = async (id: string, ticker: string) => {
    setClosingId(id);
    try {
      const res = await fnClosePosition({ data: { id } });
      const sign = res.pnl_usd >= 0 ? "+" : "";
      toast.success(`Cerrado ${ticker} @ ${usd(res.exit_price_usd)} · P&L ${sign}${usd(res.pnl_usd)} (${pct(res.pnl_pct)})`);
      await loadPositions();
    } catch (e) { toast.error("Error: " + (e as Error).message); }
    finally { setClosingId(null); }
  };

  const refreshSnap = useCallback(async () => {
    try { setSnapshot(await fetchSnapshot()); }
    catch (e) { toast.error("Error trayendo precios: " + (e as Error).message); }
  }, [fetchSnapshot]);

  useEffect(() => {
    if (!user) return;
    refreshSnap();
    const id = setInterval(refreshSnap, 30000);
    return () => clearInterval(id);
  }, [user, refreshSnap]);

  // SSE live stream
  const [streamLive, setStreamLive] = useState(false);
  useEffect(() => {
    if (!user) return;
    const es = new EventSource("/api/stream/prices");
    es.addEventListener("ready", () => setStreamLive(true));
    const apply = (ticker: string, price: number, ts: string) => {
      if (!price || price <= 0) return;
      setSnapshot(prev => prev ? { ...prev, fx_updated_at: ts, quotes: prev.quotes.map(q => q.ticker === ticker ? { ...q, price_usd: price, ts } : q) } : prev);
    };
    es.addEventListener("trade", (ev: MessageEvent) => { try { const d = JSON.parse(ev.data); apply(d.ticker, d.price, d.ts); } catch { /* noop */ } });
    es.addEventListener("quote", (ev: MessageEvent) => {
      try { const d = JSON.parse(ev.data); const mid = d.bid && d.ask ? (d.bid + d.ask) / 2 : d.ask || d.bid; apply(d.ticker, mid, d.ts); } catch { /* noop */ }
    });
    es.onerror = () => setStreamLive(false);
    return () => { es.close(); setStreamLive(false); };
  }, [user]);

  const runAnalysis = useCallback(async () => {
    if (!snapshot || !profile) return;
    setLoadingAi(true);
    try {
      const a = await fetchAnalysis({
        data: {
          capital_ars: profile.monthly_capital_ars, mep: snapshot.mep, ccl: snapshot.ccl,
          quotes: snapshot.quotes.map(q => ({ ticker: q.ticker, price_usd: q.price_usd, change_pct: q.change_pct })),
          positions: [],
        },
      });
      setAnalysis(a); setAnalysisAt(Date.now());
    } catch (e) { toast.error("Error IA: " + (e as Error).message); }
    finally { setLoadingAi(false); }
  }, [fetchAnalysis, snapshot, profile]);

  // auto-run analysis when snapshot arrives, then every N min
  const didAutoRun = useRef(false);
  useEffect(() => {
    if (!snapshot || !profile) return;
    if (!didAutoRun.current) { didAutoRun.current = true; runAnalysis(); }
  }, [snapshot, profile, runAnalysis]);
  useEffect(() => {
    if (!profile) return;
    const id = setInterval(() => { runAnalysis(); }, ANALYSIS_INTERVAL_MIN * 60 * 1000);
    return () => clearInterval(id);
  }, [profile, runAnalysis]);

  const totalCapitalUsd = snapshot?.mep ? (profile?.monthly_capital_ars || 0) / snapshot.mep : 0;
  const priceByTicker = useMemo(() => new Map((snapshot?.quotes || []).map(q => [q.ticker, q.price_usd])), [snapshot]);
  const positionsLive = useMemo(() => positions.map(p => {
    const cur = priceByTicker.get(p.ticker) || 0;
    const pnl_usd = cur ? (cur - Number(p.entry_price_usd)) * Number(p.quantity) : 0;
    const pnl_pct = cur ? (cur / Number(p.entry_price_usd) - 1) * 100 : 0;
    return { ...p, current_price_usd: cur, pnl_usd, pnl_pct };
  }), [positions, priceByTicker]);
  const totalPnlUsd = positionsLive.reduce((a, p) => a + (p.current_price_usd ? p.pnl_usd : 0), 0);
  const totalCostUsd = positionsLive.reduce((a, p) => a + Number(p.entry_price_usd) * Number(p.quantity), 0);
  const totalPnlPct = totalCostUsd ? (totalPnlUsd / totalCostUsd) * 100 : 0;

  // alerts SL/TP
  const assetByTicker = useMemo(() => new Map(assets.map(a => [a.ticker, a])), [assets]);
  const alerts = useMemo(() => {
    const list: Array<{ id: string; ticker: string; kind: "TP" | "SL" | "OK"; entry: number; current: number; pnl_pct: number; threshold_pct: number; distance_pct: number }> = [];
    for (const p of positionsLive) {
      const cfg = assetByTicker.get(p.ticker);
      if (!cfg || !p.current_price_usd) continue;
      const change = p.pnl_pct;
      let kind: "TP" | "SL" | "OK" = "OK"; let threshold = 0;
      if (change >= cfg.tp_pct) { kind = "TP"; threshold = cfg.tp_pct; }
      else if (change <= -cfg.sl_pct) { kind = "SL"; threshold = -cfg.sl_pct; }
      else { const dTp = cfg.tp_pct - change; const dSl = change + cfg.sl_pct; threshold = dTp < dSl ? cfg.tp_pct : -cfg.sl_pct; }
      list.push({ id: p.id, ticker: p.ticker, kind, entry: Number(p.entry_price_usd), current: p.current_price_usd, pnl_pct: change, threshold_pct: threshold, distance_pct: threshold - change });
    }
    list.sort((a, b) => (a.kind === "OK" ? 1 : 0) - (b.kind === "OK" ? 1 : 0));
    return list;
  }, [positionsLive, assetByTicker]);
  const triggeredCount = alerts.filter(a => a.kind !== "OK").length;
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

  // history
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [histSearch, setHistSearch] = useState("");
  const [histFrom, setHistFrom] = useState("");
  const [histTo, setHistTo] = useState("");
  const [histStatus, setHistStatus] = useState<"all" | "open" | "closed">("all");
  const loadHistory = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("positions")
      .select("id, ticker, quantity, entry_price_usd, entry_date, exit_price_usd, exit_date, status, pnl_usd, pnl_pct")
      .eq("user_id", user.id).order("entry_date", { ascending: false }).limit(500);
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

  // chat
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
    setChatMsgs(next); setChatInput(""); setChatSending(true);
    try {
      const res = await fnChat({
        data: {
          messages: next.slice(-20),
          context: snapshot ? { mep: snapshot.mep, ccl: snapshot.ccl, quotes: snapshot.quotes.map(q => ({ ticker: q.ticker, price_usd: q.price_usd, change_pct: q.change_pct })) } : undefined,
        },
      });
      setChatMsgs(m => [...m, { role: "assistant", content: res.reply }]);
    } catch (e) {
      toast.error("Error chat: " + (e as Error).message);
      setChatMsgs(m => [...m, { role: "assistant", content: "⚠️ " + (e as Error).message }]);
    } finally { setChatSending(false); }
  };

  // ----- Opportunities (auto-sorted) -----
  const opportunities = useMemo(() => {
    const portfolioTickers = new Set(assets.map(a => a.ticker));
    const allTickers = new Set([...portfolioTickers, ...(snapshot?.quotes.map(q => q.ticker) || [])]);
    const sigByTicker = new Map(analysis?.assets.map(s => [s.ticker, s]) || []);
    return Array.from(allTickers).map(t => {
      const q = snapshot?.quotes.find(x => x.ticker === t);
      const sig = sigByTicker.get(t);
      const inPortfolio = portfolioTickers.has(t);
      return {
        ticker: t,
        name: TICKER_NAMES[t] || assets.find(a => a.ticker === t)?.name || t,
        price_usd: q?.price_usd || 0,
        change_pct: q?.change_pct || 0,
        sig,
        inPortfolio,
        prob: sig?.probability_pct ?? 0,
      };
    }).sort((a, b) => b.prob - a.prob);
  }, [assets, snapshot, analysis]);

  const topPick = opportunities.find(o => o.sig);
  const ccl = snapshot?.ccl || 0;
  const cclState: "ok" | "loading" | "fail" = ccl > 0 ? "ok" : snapshot ? "fail" : "loading";

  if (authLoading || !profile) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Cargando...</div>;
  }

  const minsAgo = analysisAt ? Math.max(0, Math.floor((now - analysisAt) / 60000)) : null;
  const minsToNext = analysisAt ? Math.max(0, ANALYSIS_INTERVAL_MIN - (minsAgo || 0)) : ANALYSIS_INTERVAL_MIN;

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
          <MetricCard label="CCL" value={ccl ? ars(ccl) : cclState === "loading" ? "Calculando…" : "Sin CCL"} sub={snapshot ? timeAgo(snapshot.fx_updated_at) : ""} />
          <MetricCard label="Score IA" value={analysis ? `${Math.round(analysis.market_score)}/100` : "—"} sub={analysis?.market_score_label || (loadingAi ? "Analizando…" : "Pendiente")} highlight />
        </section>

        <Tabs defaultValue="oportunidades" className="w-full">
          <TabsList className="grid grid-cols-5 w-full md:w-auto md:inline-flex">
            <TabsTrigger value="oportunidades" className="gap-1"><Target className="size-3" /> Oportunidades</TabsTrigger>
            <TabsTrigger value="posiciones" className="gap-1"><TrendingUp className="size-3" /> Posiciones</TabsTrigger>
            <TabsTrigger value="alertas" className="gap-1">
              <Bell className="size-3" /> Alertas
              {triggeredCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center text-[10px] font-bold rounded-full bg-destructive text-destructive-foreground size-4">{triggeredCount}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="chat" className="gap-1"><MessageSquare className="size-3" /> Chat IA</TabsTrigger>
            <TabsTrigger value="historial" className="gap-1"><History className="size-3" /> Historial</TabsTrigger>
          </TabsList>

          {/* OPORTUNIDADES */}
          <TabsContent value="oportunidades" className="space-y-4 mt-4">
            {/* Banner top recommendation */}
            {topPick?.sig && (
              <section className={`bg-gradient-to-r ${bannerBg(topPick.sig.signal)} border rounded-xl p-5 shadow-card`}>
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="text-4xl">🎯</div>
                  <div className="flex-1 min-w-[240px]">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">El Oráculo recomienda</div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="text-2xl md:text-3xl font-display font-bold">
                        {topPick.sig.signal} {topPick.ticker}
                      </h2>
                      <SignalPill signal={topPick.sig.signal} large />
                    </div>
                    <p className="text-sm mt-2 leading-relaxed max-w-3xl">{topPick.sig.action_reason}</p>
                    <div className="mt-3 flex items-center gap-4 text-xs flex-wrap">
                      <span>Probabilidad: <strong className="text-success text-base">{topPick.sig.probability_pct}%</strong></span>
                      <span>Retorno estimado: <strong>{pct(topPick.sig.estimated_return_pct)}</strong> · {topPick.sig.horizon}</span>
                      <span>Riesgo: <strong className={riskColor(topPick.sig.risk_level)}>{topPick.sig.risk_level}</strong></span>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Status bar */}
            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              <Brain className="size-3.5 text-primary" />
              {loadingAi && !analysis ? (
                <span>Oráculo analizando el mercado…</span>
              ) : analysisAt ? (
                <span>
                  Análisis IA actualizado hace {minsAgo === 0 ? "menos de 1" : minsAgo} min ·
                  próximo análisis en {minsToNext} min
                </span>
              ) : (
                <span>Esperando precios para analizar…</span>
              )}
              <Button onClick={() => { refreshSnap(); runAnalysis(); }} disabled={loadingAi || !snapshot} variant="ghost" size="sm" className="ml-auto h-7">
                <RefreshCw className={`size-3.5 mr-1 ${loadingAi ? "animate-spin" : ""}`} />
                Actualizar ahora
              </Button>
            </div>

            {analysis?.market_context && (
              <section className="bg-card border rounded-xl p-4 shadow-card">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Contexto del mercado hoy</div>
                <p className="text-sm leading-relaxed">{analysis.market_context}</p>
              </section>
            )}

            {/* Cards list sorted by probability */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-semibold flex items-center gap-2">🔥 Mejores oportunidades ahora</h2>
                <span className="text-xs text-muted-foreground">{opportunities.length} activos · ordenados por probabilidad</span>
              </div>

              {opportunities.length === 0 && <Skeleton className="h-32 w-full" />}

              {opportunities.map((o, idx) => {
                const priceArs = o.price_usd && cclState === "ok" ? o.price_usd * ccl : 0;
                const arsLabel = priceArs ? ars(priceArs)
                  : cclState === "loading" ? "Calculando ARS…"
                  : `Sin CCL${snapshot ? ` · hace ${timeAgo(snapshot.fx_updated_at)}` : ""}`;
                const prob = o.sig?.probability_pct ?? 0;
                return (
                  <article key={o.ticker} className={`bg-card border rounded-xl p-4 shadow-card ${idx === 0 && o.sig ? "border-primary/40 shadow-glow" : ""}`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-display font-bold text-xl">{o.ticker}</span>
                          <span className="text-sm text-muted-foreground">{o.name}</span>
                          {o.inPortfolio && <Badge variant="outline" className="text-[10px]">en cartera</Badge>}
                        </div>
                        <div className="mt-1 text-sm font-mono flex items-center gap-3 flex-wrap" data-mono>
                          {o.price_usd ? usd(o.price_usd) : <Skeleton className="h-4 w-16 inline-block" />}
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">{arsLabel}</span>
                          {o.price_usd ? (
                            <span className={`inline-flex items-center gap-1 ${o.change_pct >= 0 ? "text-success" : "text-destructive"}`}>
                              {o.change_pct >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                              {pct(o.change_pct)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="text-right">
                        {o.sig ? <SignalPill signal={o.sig.signal} large /> : <Skeleton className="h-8 w-24" />}
                      </div>
                    </div>

                    {o.sig ? (
                      <div className="mt-4 grid md:grid-cols-[1fr_auto] gap-4 items-start">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-3xl font-display font-bold text-success leading-none">{prob}%</span>
                            <div className="flex-1">
                              <div className="text-xs text-muted-foreground mb-1">Probabilidad de ganancia</div>
                              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                                <div className="h-full bg-success transition-all" style={{ width: `${Math.min(100, prob)}%` }} />
                              </div>
                            </div>
                            <span className={`text-xs font-semibold ${riskColor(o.sig.risk_level)}`}>{o.sig.risk_level}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Retorno estimado: <span className="text-foreground font-semibold">{pct(o.sig.estimated_return_pct)}</span> · {o.sig.horizon}
                          </div>
                          <p className="text-sm mt-2 leading-relaxed"><span className="text-muted-foreground text-xs">Por qué: </span>{o.sig.action_reason}</p>
                          {o.sig.risk_note && <p className="text-xs text-muted-foreground mt-1 italic">{o.sig.risk_note}</p>}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-3/4" />
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          </TabsContent>

          {/* POSICIONES */}
          <TabsContent value="posiciones" className="mt-4">
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
                  Sin posiciones abiertas. El Oráculo es una herramienta de análisis: vos ejecutás las operaciones en tu broker.
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
                  <h2 className="font-display font-semibold flex items-center gap-2"><Bell className="size-4 text-primary" /> Alertas SL/TP</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Monitoreo automático en tiempo real. Stop Loss y Take Profit por activo.</p>
                </div>
                <span className="text-xs text-muted-foreground">{triggeredCount} gatilladas</span>
              </div>
              {alerts.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-10">Sin posiciones abiertas para monitorear.</div>
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
                        const colorRow = a.kind === "TP" ? "bg-success/10" : a.kind === "SL" ? "bg-destructive/10" : "";
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
                            <td className={`px-4 py-3 text-right font-mono ${a.pnl_pct >= 0 ? "text-success" : "text-destructive"}`} data-mono>{pct(a.pnl_pct)}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs hidden sm:table-cell text-muted-foreground" data-mono>{cfg ? `-${cfg.sl_pct}% / +${cfg.tp_pct}%` : "—"}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs hidden md:table-cell text-muted-foreground" data-mono>{a.kind === "OK" ? `${a.distance_pct >= 0 ? "+" : ""}${a.distance_pct.toFixed(2)}%` : "—"}</td>
                            <td className="px-4 py-3 text-right">
                              {a.kind !== "OK" && (
                                <Button size="sm" variant="outline" disabled={closingId === a.id} onClick={() => handleClose(a.id, a.ticker)}>
                                  <X className="size-3 mr-1" />{closingId === a.id ? "Cerrando..." : "Cerrar"}
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

          {/* CHAT */}
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
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {chatSending && (
                  <div className="flex justify-start">
                    <div className="bg-secondary text-secondary-foreground rounded-lg px-3 py-2 text-sm animate-pulse">Oráculo está pensando…</div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <form className="border-t p-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); sendChat(); }}>
                <Input placeholder="Preguntá: ¿conviene comprar NVDA hoy?" value={chatInput} onChange={(e) => setChatInput(e.target.value)} disabled={chatSending} />
                <Button type="submit" size="sm" disabled={chatSending || !chatInput.trim()}><Send className="size-4" /></Button>
              </form>
            </section>
          </TabsContent>

          {/* HISTORIAL */}
          <TabsContent value="historial" className="mt-4">
            <section className="bg-card border rounded-xl shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b">
                <h2 className="font-display font-semibold flex items-center gap-2"><History className="size-4 text-primary" /> Historial de operaciones</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                  <div className="relative">
                    <Search className="size-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-7 h-8 text-xs" placeholder="Ticker" value={histSearch} onChange={(e) => setHistSearch(e.target.value)} />
                  </div>
                  <Input type="date" className="h-8 text-xs" value={histFrom} onChange={(e) => setHistFrom(e.target.value)} />
                  <Input type="date" className="h-8 text-xs" value={histTo} onChange={(e) => setHistTo(e.target.value)} />
                  <select value={histStatus} onChange={(e) => setHistStatus(e.target.value as "all" | "open" | "closed")} className="h-8 text-xs rounded-md border border-input bg-transparent px-2">
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
                          <td className="px-4 py-3 hidden sm:table-cell text-xs text-muted-foreground">{new Date(h.entry_date).toLocaleDateString("es-AR")}</td>
                          <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">{h.exit_date ? new Date(h.exit_date).toLocaleDateString("es-AR") : "—"}</td>
                          <td className="px-4 py-3 text-right font-mono" data-mono>{Number(h.quantity)}</td>
                          <td className="px-4 py-3 text-right font-mono text-muted-foreground" data-mono>{usd(Number(h.entry_price_usd))}</td>
                          <td className="px-4 py-3 text-right font-mono hidden sm:table-cell" data-mono>{h.exit_price_usd ? usd(Number(h.exit_price_usd)) : "—"}</td>
                          <td className={`px-4 py-3 text-right font-mono ${closed ? (positive ? "text-success" : "text-destructive") : "text-muted-foreground"}`} data-mono>
                            {closed && h.pnl_usd != null ? `${positive ? "+" : ""}${usd(Number(h.pnl_usd))} (${pct(Number(h.pnl_pct))})` : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {closed ? <Badge variant="outline" className="text-muted-foreground">Cerrada</Badge> : <Badge variant="outline" className="bg-info/15 text-info border-info/30">Abierta</Badge>}
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
              <div className="px-4 py-2 text-xs text-muted-foreground border-t">{filteredHistory.length} de {history.length} operaciones</div>
            </section>
          </TabsContent>
        </Tabs>

        <p className="text-xs text-muted-foreground text-center pt-4 pb-8 flex items-center justify-center gap-1">
          <AlertTriangle className="size-3" /> App educativa · No constituye asesoramiento financiero
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
