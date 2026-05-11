import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef, memo } from "react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usd, ars, pct, timeAgo } from "@/lib/format";
import { toast } from "sonner";
import { usePrices, usePriceFor } from "@/lib/pricesStore";
import { useCcl } from "@/lib/useCcl";
import { PriceCell } from "@/components/PriceCell";
import {
  TICKER_CATALOG,
  TICKER_NAME,
  TICKER_CATEGORY,
  CATEGORY_LABELS,
  type TickerCategory,
} from "@/lib/tickers";
import {
  Sparkles, RefreshCw, LogOut, Brain, TrendingUp, AlertTriangle,
  X, Bell, MessageSquare, History, Send, Search, ArrowUp, ArrowDown, Pause, ArrowRight, Target,
  ChevronDown, ChevronUp,
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
type CategoryFilter = "all" | TickerCategory;

const ANALYSIS_INTERVAL_MIN = 5;
const INITIAL_VISIBLE = 10;
const PAGE_SIZE = 10;


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
  if (s === "COMPRAR") return "from-success/30 via-success/10 to-transparent border-success/40";
  if (s === "VENDER") return "from-destructive/30 via-destructive/10 to-transparent border-destructive/40";
  if (s === "ESPERAR") return "from-warning/20 via-warning/5 to-transparent border-warning/30";
  return "from-muted via-muted/30 to-transparent border-border";
}

function scoreColor(score: number) {
  if (score >= 70) return "text-success border-success/40";
  if (score >= 40) return "text-warning border-warning/40";
  return "text-destructive border-destructive/40";
}


function Dashboard() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const fetchSnapshot = useServerFn(getMarketSnapshot);
  const fetchAnalysis = useServerFn(analyzeMarket);
  const fnClosePosition = useServerFn(closePosition);
  const fnChat = useServerFn(chatWithOraculo);

  const setBulkPrices = usePrices((s) => s.setBulk);
  const setOnePrice = usePrices((s) => s.setOne);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [analysisAt, setAnalysisAt] = useState<number | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const cclState = useCcl();

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [tickerSearch, setTickerSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

  // 1s tick for countdowns
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  

  // auth gate
  useEffect(() => { if (!authLoading && !user) navigate({ to: "/auth" }); }, [authLoading, user, navigate]);

  // load profile + portfolio (assets table only used for SL/TP config + positions)
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase.from("profiles").select("name, monthly_capital_ars, onboarding_completed").eq("id", user.id).maybeSingle();
      if (!p?.onboarding_completed) { navigate({ to: "/onboarding" }); return; }
      setProfile(p as Profile);
      const { data: a } = await supabase.from("portfolio_assets").select("*").eq("user_id", user.id).eq("is_active", true);
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

  // Snapshot (fx + clock + bulk prices). SSE updates only the price store.
  const refreshSnap = useCallback(async () => {
    try {
      const snap = await fetchSnapshot();
      setSnapshot(snap);
      setBulkPrices(snap.quotes);
      if (snap.ccl > 0) {
        writeCachedCcl(snap.ccl);
        setCachedCcl({ value: snap.ccl, ts: Date.now() });
      }
    } catch (e) { toast.error("Error trayendo precios: " + (e as Error).message); }
  }, [fetchSnapshot, setBulkPrices]);

  useEffect(() => {
    if (!user) return;
    refreshSnap();
    // Re-fetch CCL/snapshot every 30s; if CCL is missing keep retrying.
    const id = setInterval(refreshSnap, 30000);
    return () => clearInterval(id);
  }, [user, refreshSnap]);

  // SSE live stream — uses ref to avoid reconnects on re-render.
  const [streamLive, setStreamLive] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => {
    if (!user) return;
    if (esRef.current) return;
    const es = new EventSource("/api/stream/prices");
    esRef.current = es;
    es.addEventListener("ready", () => setStreamLive(true));
    es.addEventListener("trade", (ev: MessageEvent) => {
      try { const d = JSON.parse(ev.data); setOnePrice(d.ticker, d.price, d.ts); } catch { /* noop */ }
    });
    es.addEventListener("quote", (ev: MessageEvent) => {
      try {
        const d = JSON.parse(ev.data);
        const mid = d.bid && d.ask ? (d.bid + d.ask) / 2 : d.ask || d.bid;
        setOnePrice(d.ticker, mid, d.ts);
      } catch { /* noop */ }
    });
    es.onerror = () => setStreamLive(false);
    return () => { es.close(); esRef.current = null; setStreamLive(false); };
  }, [user, setOnePrice]);

  // Analysis is INDEPENDENT of price ticks — only re-runs on interval / manual.
  const runAnalysis = useCallback(async () => {
    const snap = snapshot;
    if (!snap || !profile) return;
    setLoadingAi(true);
    try {
      // Snapshot ya trae todos los tickers; mandamos los que tienen precio.
      const quotes = snap.quotes.filter((q) => q.price_usd > 0).map((q) => ({
        ticker: q.ticker, price_usd: q.price_usd, change_pct: q.change_pct,
      }));
      const a = await fetchAnalysis({
        data: {
          capital_ars: profile.monthly_capital_ars, mep: snap.mep, ccl: snap.ccl || cachedCcl?.value || 0,
          quotes, positions: [],
        },
      });
      setAnalysis(a); setAnalysisAt(Date.now());
    } catch (e) { toast.error("Error IA: " + (e as Error).message); }
    finally { setLoadingAi(false); }
  }, [fetchAnalysis, snapshot, profile, cachedCcl]);

  // Trigger once when first snapshot+profile arrive, and every N minutes thereafter.
  const didAutoRun = useRef(false);
  useEffect(() => {
    if (!snapshot || !profile || didAutoRun.current) return;
    didAutoRun.current = true;
    runAnalysis();
  }, [snapshot, profile, runAnalysis]);
  useEffect(() => {
    if (!profile) return;
    const id = setInterval(() => { runAnalysis(); }, ANALYSIS_INTERVAL_MIN * 60 * 1000);
    return () => clearInterval(id);
  }, [profile, runAnalysis]);

  // --- Live derived data ---
  const ccl = snapshot?.ccl || 0;
  // Fallback: MEP if CCL missing. Then localStorage.
  const cclEffective = ccl > 0 ? ccl : (snapshot?.mep || cachedCcl?.value || 0);
  const cclSource: "live" | "mep" | "cache" | "none" =
    ccl > 0 ? "live" : snapshot?.mep ? "mep" : cachedCcl ? "cache" : "none";

  // positions live (from store)
  const positionsLive = usePositionsLive(positions);
  const totalPnlUsd = positionsLive.reduce((a, p) => a + (p.current_price_usd ? p.pnl_usd : 0), 0);
  const totalCostUsd = positionsLive.reduce((a, p) => a + Number(p.entry_price_usd) * Number(p.quantity), 0);
  const totalPnlPct = totalCostUsd ? (totalPnlUsd / totalCostUsd) * 100 : 0;

  // alerts SL/TP
  const assetByTicker = useMemo(() => new Map(assets.map((a) => [a.ticker, a])), [assets]);
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
  const triggeredCount = alerts.filter((a) => a.kind !== "OK").length;
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
    return history.filter((h) => {
      if (q && !h.ticker.includes(q)) return false;
      if (histStatus !== "all" && h.status !== histStatus) return false;
      const t = new Date(h.entry_date).getTime();
      if (t < from || t > to) return false;
      return true;
    });
  }, [history, histSearch, histFrom, histTo, histStatus]);

  // chat
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([
    { role: "assistant", content: "Hola 👋 Soy Oráculo. Preguntame sobre cualquier ticker, MEP/CCL o el contexto de mercado. (No es asesoramiento financiero)" },
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
          context: snapshot ? { mep: snapshot.mep, ccl: snapshot.ccl, quotes: snapshot.quotes.map((q) => ({ ticker: q.ticker, price_usd: q.price_usd, change_pct: q.change_pct })) } : undefined,
        },
      });
      setChatMsgs((m) => [...m, { role: "assistant", content: res.reply }]);
    } catch (e) {
      toast.error("Error chat: " + (e as Error).message);
      setChatMsgs((m) => [...m, { role: "assistant", content: "⚠️ " + (e as Error).message }]);
    } finally { setChatSending(false); }
  };

  // ----- Opportunities (auto-sorted, filterable) -----
  const opportunities = useMemo(() => {
    const sigByTicker = new Map(analysis?.assets.map((s) => [s.ticker, s]) || []);
    const q = tickerSearch.trim().toUpperCase();
    return TICKER_CATALOG
      .filter((t) => categoryFilter === "all" || t.category === categoryFilter)
      .filter((t) => !q || t.symbol.includes(q) || t.name.toUpperCase().includes(q))
      .map((t) => {
        const sig = sigByTicker.get(t.symbol);
        return {
          ticker: t.symbol,
          name: t.name,
          category: t.category,
          sig,
          prob: sig?.probability_pct ?? 0,
          hasSignal: !!sig,
        };
      })
      .sort((a, b) => {
        if (a.hasSignal !== b.hasSignal) return a.hasSignal ? -1 : 1;
        return b.prob - a.prob;
      });
  }, [analysis, categoryFilter, tickerSearch]);

  const visibleOpportunities = showAll ? opportunities : opportunities.slice(0, visibleCount);
  const topPick = opportunities.find((o) => o.sig);

  if (authLoading || !profile) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Cargando...</div>;
  }

  // ===== Metrics =====
  const score = analysis ? Math.round(analysis.market_score) : 0;
  const cclMinsAgo = cachedCcl ? Math.max(0, Math.floor((Date.now() - cachedCcl.ts) / 60000)) : null;
  const marketStateLabel = (() => {
    if (!snapshot) return { dot: "bg-muted-foreground", text: "—", sub: "Cargando" };
    if (snapshot.is_open) {
      const closeAt = snapshot.next_close ? new Date(snapshot.next_close).getTime() : 0;
      const diffMs = Math.max(0, closeAt - Date.now());
      const h = Math.floor(diffMs / 3600000);
      const m = Math.floor((diffMs % 3600000) / 60000);
      return { dot: "bg-success animate-pulse", text: "Abierto", sub: closeAt ? `Cierra en ${h}h ${m}m` : "NYSE en vivo" };
    }
    const openAt = snapshot.next_open ? new Date(snapshot.next_open).getTime() : 0;
    const diffMs = Math.max(0, openAt - Date.now());
    const h = Math.floor(diffMs / 3600000);
    return { dot: "bg-muted-foreground", text: "Cerrado", sub: openAt ? `Abre en ~${h}h` : "Fuera de horario" };
  })();

  const secsUntilNext = (() => {
    if (!analysisAt) return loadingAi ? 0 : ANALYSIS_INTERVAL_MIN * 60;
    const elapsed = Math.floor((now - analysisAt) / 1000);
    return Math.max(0, ANALYSIS_INTERVAL_MIN * 60 - elapsed);
  })();
  const countdownLabel = `${Math.floor(secsUntilNext / 60)}:${String(secsUntilNext % 60).padStart(2, "0")}`;

  const cclDisplay = (() => {
    if (cclSource === "live") return { value: ars(cclEffective), sub: snapshot ? `Dólar CCL · ${timeAgo(snapshot.fx_updated_at)}` : "" };
    if (cclSource === "mep") return { value: ars(cclEffective), sub: "Usando MEP como fallback" };
    if (cclSource === "cache" && cachedCcl) return { value: ars(cachedCcl.value), sub: `CCL no disponible · último hace ${cclMinsAgo}m` };
    return { value: "Reintentando…", sub: "Sin red" };
  })();

  return (
    <TooltipProvider>
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
        {/* ===== METRICS (sin Capital) ===== */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className={`bg-card border rounded-xl p-4 shadow-card ${analysis ? scoreColor(score) : ""}`}>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Score del mercado</div>
            <div className="text-2xl md:text-3xl font-display font-bold mt-1" data-mono>
              {analysis ? `${score}/100` : "—"}
            </div>
            <div className="text-xs mt-1 font-medium">
              {analysis?.market_score_label || (loadingAi ? "Analizando…" : "Pendiente")}
            </div>
          </div>

          <div className="bg-card border rounded-xl p-4 shadow-card">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Dólar CCL</div>
            <div className="text-2xl md:text-3xl font-display font-bold mt-1" data-mono>{cclDisplay.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{cclDisplay.sub}</div>
          </div>

          <div className="bg-card border rounded-xl p-4 shadow-card">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Estado del mercado</div>
            <div className="text-2xl md:text-3xl font-display font-bold mt-1 flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${marketStateLabel.dot}`} />
              {marketStateLabel.text}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{marketStateLabel.sub}</div>
          </div>

          <div className="bg-card border rounded-xl p-4 shadow-card border-primary/40 shadow-glow">
            <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Brain className="size-3" /> Próximo análisis IA
            </div>
            <div className="text-2xl md:text-3xl font-display font-bold mt-1 font-mono" data-mono>
              {loadingAi ? "Ahora…" : countdownLabel}
            </div>
            <div className="text-xs mt-1 inline-flex items-center gap-1 text-success">
              <span className="size-1.5 rounded-full bg-success animate-pulse" /> IA activa
            </div>
          </div>
        </section>

        <Tabs defaultValue="oportunidades" className="w-full">
          <TabsList className="grid grid-cols-3 md:grid-cols-6 w-full md:w-auto md:inline-flex">
            <TabsTrigger value="oportunidades" className="gap-1"><Target className="size-3" /> Oportunidades</TabsTrigger>
            <TabsTrigger value="operaciones" className="gap-1"><TrendingUp className="size-3" /> Mis operaciones</TabsTrigger>
            <TabsTrigger value="alertas" className="gap-1">
              <Bell className="size-3" /> Alertas
              {triggeredCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center text-[10px] font-bold rounded-full bg-destructive text-destructive-foreground size-4">{triggeredCount}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="chat" className="gap-1"><MessageSquare className="size-3" /> Chat IA</TabsTrigger>
            <TabsTrigger value="historial" className="gap-1"><History className="size-3" /> Historial</TabsTrigger>
            <TabsTrigger value="crypto" className="gap-1" disabled>
              ₿ Crypto <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0">próx.</Badge>
            </TabsTrigger>
          </TabsList>

          {/* ===== OPORTUNIDADES ===== */}
          <TabsContent value="oportunidades" className="space-y-4 mt-4">
            {/* Banner top recommendation */}
            {topPick?.sig && (
              <section className={`bg-gradient-to-r ${bannerBg(topPick.sig.signal)} border rounded-xl p-5 shadow-card`}>
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="text-4xl">🎯</div>
                  <div className="flex-1 min-w-[240px]">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Mayor oportunidad ahora</div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="text-2xl md:text-3xl font-display font-bold">
                        {topPick.sig.signal} {topPick.ticker}
                      </h2>
                      <SignalPill signal={topPick.sig.signal} large />
                      <span className="text-base">· {topPick.sig.probability_pct}% prob · {pct(topPick.sig.estimated_return_pct)} est.</span>
                    </div>
                    <p className="text-sm mt-2 leading-relaxed max-w-3xl">{topPick.sig.action_reason}</p>
                  </div>
                </div>
              </section>
            )}

            {/* Status bar + filters */}
            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              <Brain className="size-3.5 text-primary" />
              {loadingAi && !analysis ? <span>Oráculo analizando el mercado…</span>
              : analysisAt ? (
                <span>🔥 Mejores oportunidades · actualizado {timeAgo(new Date(analysisAt).toISOString())}</span>
              ) : <span>Esperando precios para analizar…</span>}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={() => { refreshSnap(); runAnalysis(); }} disabled={loadingAi || !snapshot} variant="ghost" size="sm" className="ml-auto h-7">
                    <RefreshCw className={`size-3.5 mr-1 ${loadingAi ? "animate-spin" : ""}`} />
                    Actualizar análisis
                  </Button>
                </TooltipTrigger>
                <TooltipContent>El análisis se actualiza automáticamente cada {ANALYSIS_INTERVAL_MIN} minutos</TooltipContent>
              </Tooltip>
            </div>

            {/* Category pills + search */}
            <div className="flex flex-wrap gap-2 items-center">
              <CategoryPill active={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>Todos</CategoryPill>
              <CategoryPill active={categoryFilter === "tech"} onClick={() => setCategoryFilter("tech")}>CEDEARs Tech</CategoryPill>
              <CategoryPill active={categoryFilter === "arg"} onClick={() => setCategoryFilter("arg")}>Argentina</CategoryPill>
              <CategoryPill active={categoryFilter === "fin"} onClick={() => setCategoryFilter("fin")}>Finanzas</CategoryPill>
              <CategoryPill active={categoryFilter === "energy"} onClick={() => setCategoryFilter("energy")}>Energía</CategoryPill>
              <CategoryPill active={categoryFilter === "etf"} onClick={() => setCategoryFilter("etf")}>ETFs</CategoryPill>
              <CategoryPill active={categoryFilter === "health"} onClick={() => setCategoryFilter("health")}>Salud</CategoryPill>
              <CategoryPill active={categoryFilter === "consumer"} onClick={() => setCategoryFilter("consumer")}>Consumo</CategoryPill>
              <div className="relative ml-auto">
                <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-7 h-8 text-xs w-56" placeholder="Buscar ticker o empresa…" value={tickerSearch} onChange={(e) => setTickerSearch(e.target.value)} />
              </div>
            </div>

            {analysis?.market_context && (
              <section className="bg-card border rounded-xl p-4 shadow-card">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Contexto del mercado hoy</div>
                <p className="text-sm leading-relaxed">{analysis.market_context}</p>
              </section>
            )}

            <section className="space-y-3">
              {opportunities.length === 0 && (
                <>
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </>
              )}

              {visibleOpportunities.map((o, idx) => (
                <OpportunityCard
                  key={o.ticker}
                  ticker={o.ticker}
                  name={o.name}
                  category={o.category}
                  sig={o.sig}
                  ccl={cclEffective}
                  highlight={idx === 0 && !!o.sig}
                  expanded={expandedTicker === o.ticker}
                  onToggle={() => setExpandedTicker((cur) => cur === o.ticker ? null : o.ticker)}
                />
              ))}

              {!showAll && opportunities.length > visibleCount && (
                <div className="flex justify-center gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                    Cargar más ({opportunities.length - visibleCount} restantes)
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                    Ver todos ({opportunities.length})
                  </Button>
                </div>
              )}
            </section>
          </TabsContent>

          {/* ===== MIS OPERACIONES ===== */}
          <TabsContent value="operaciones" className="mt-4">
            <section className="bg-card border rounded-xl shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
                <h2 className="font-display font-semibold">Mis operaciones abiertas</h2>
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
                  Sin operaciones abiertas. El Oráculo es una herramienta de análisis: vos ejecutás las operaciones en tu broker.
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
                      {positionsLive.map((p) => {
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

          {/* ===== ALERTAS ===== */}
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
                      {alerts.map((a) => {
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

          {/* ===== CHAT ===== */}
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

          {/* ===== HISTORIAL ===== */}
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
                    {filteredHistory.map((h) => {
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
    </TooltipProvider>
  );
}

// ============ Subcomponents ============

function CategoryPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
        active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/40 text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

type OpportunityCardProps = {
  ticker: string;
  name: string;
  category: TickerCategory;
  sig?: AssetSignal;
  ccl: number;
  highlight: boolean;
  expanded: boolean;
  onToggle: () => void;
};

const OpportunityCard = memoCard(function OpportunityCardImpl({
  ticker, name, category, sig, ccl, highlight, expanded, onToggle,
}: OpportunityCardProps) {
  const prob = sig?.probability_pct ?? 0;
  const tick = usePriceFor(ticker);
  const volumeBadge = (() => {
    const ch = Math.abs(tick?.change_pct || 0);
    if (ch >= 3) return { label: "Alto", cls: "bg-success/20 text-success border-success/40" };
    if (ch >= 1) return { label: "Normal", cls: "bg-info/20 text-info border-info/40" };
    return { label: "Bajo", cls: "bg-muted text-muted-foreground border-border" };
  })();

  return (
    <article className={`bg-card border rounded-xl shadow-card transition-all ${highlight ? "border-primary/40 shadow-glow" : ""}`}>
      <button onClick={onToggle} className="w-full text-left p-4 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-display font-bold text-xl">{ticker}</span>
            <span className="text-sm text-muted-foreground">{name}</span>
            <Badge variant="outline" className="text-[10px]">{CATEGORY_LABELS[category]}</Badge>
            <Badge variant="outline" className={`text-[10px] ${volumeBadge.cls}`}>Vol. {volumeBadge.label}</Badge>
          </div>
          <div className="mt-1 text-sm">
            <PriceCell symbol={ticker} ccl={ccl} />
          </div>
        </div>
        <div className="text-right flex flex-col items-end gap-1">
          {sig ? (
            <>
              <SignalPill signal={sig.signal} large />
              <span className="text-xs font-bold text-success">{prob}% prob.</span>
            </>
          ) : (
            <Skeleton className="h-8 w-24" />
          )}
        </div>
        {sig && (
          <span className="ml-2 text-muted-foreground self-center">
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </span>
        )}
      </button>

      {sig && expanded && (
        <div className="px-4 pb-4 border-t pt-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl font-display font-bold text-success leading-none">{prob}%</span>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground mb-1">Probabilidad de ganancia</div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-success transition-all" style={{ width: `${Math.min(100, prob)}%` }} />
              </div>
            </div>
            <span className={`text-xs font-semibold ${riskColor(sig.risk_level)}`}>Riesgo {sig.risk_level}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Retorno estimado: <span className="text-foreground font-semibold">{pct(sig.estimated_return_pct)}</span> · {sig.horizon}
          </div>
          <p className="text-sm mt-2 leading-relaxed">
            <span className="text-muted-foreground text-xs">Por qué: </span>{sig.action_reason}
          </p>
          {sig.risk_note && <p className="text-xs text-muted-foreground mt-1 italic">{sig.risk_note}</p>}
        </div>
      )}
    </article>
  );
});

// React.memo wrapper — prices isolated via store, so card only re-renders
// when its own analysis signal / expansion / ccl actually change.
function memoCard(Component: React.FC<OpportunityCardProps>) {
  return memo(Component, (prev, next) =>
    prev.ticker === next.ticker &&
    prev.sig === next.sig &&
    prev.ccl === next.ccl &&
    prev.highlight === next.highlight &&
    prev.expanded === next.expanded &&
    prev.name === next.name &&
    prev.category === next.category,
  );
}

// Hook: live positions PnL using store, so price ticks recompute without re-fetch.
function usePositionsLive(positions: Position[]) {
  const bySymbol = usePrices((s) => s.bySymbol);
  return useMemo(() => positions.map((p) => {
    const cur = bySymbol[p.ticker]?.price || 0;
    const pnl_usd = cur ? (cur - Number(p.entry_price_usd)) * Number(p.quantity) : 0;
    const pnl_pct = cur ? (cur / Number(p.entry_price_usd) - 1) * 100 : 0;
    return { ...p, current_price_usd: cur, pnl_usd, pnl_pct };
  }), [positions, bySymbol]);
}

// silence unused warnings for symbols we keep imported intentionally
void TICKER_NAME; void TICKER_CATEGORY;
