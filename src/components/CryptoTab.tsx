import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getCryptoSnapshot, analyzeCrypto, type CryptoQuote, type CryptoMarket, type CryptoSignal } from "@/lib/crypto.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { usd } from "@/lib/format";
import { Bell, RefreshCw, TrendingUp, TrendingDown, X, Trash2, CheckCircle2, XCircle } from "lucide-react";


type Alert = { id: string; ticker: string; target_price: number; direction: "above" | "below"; is_triggered: boolean; created_at: string };
type Trade = {
  id: string; ticker: string; signal: string;
  entry_price_usd: number; stop_price_usd: number; target_price_usd: number;
  capital_usd: number; status: string;
  exit_price_usd: number | null; pnl_usd: number | null; pnl_pct: number | null;
  closed_at: string | null; created_at: string;
};

const POLL_MS = 30_000;

function fearGreedColor(v: number) {
  if (v <= 25) return "bg-success/20 text-success border-success/40";
  if (v <= 49) return "bg-warning/20 text-warning border-warning/40";
  if (v <= 74) return "bg-info/20 text-info border-info/40";
  return "bg-destructive/20 text-destructive border-destructive/40";
}

function ratioBadge(stop: number, target: number, entry: number) {
  if (!entry || !stop || !target) return null;
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (risk === 0) return null;
  const ratio = reward / risk;
  if (ratio >= 3) return { label: `1:${ratio.toFixed(2)} 🔥 Excelente`, cls: "text-success" };
  if (ratio >= 2) return { label: `1:${ratio.toFixed(2)} ✅ Bueno`, cls: "text-success" };
  if (ratio >= 1.5) return { label: `1:${ratio.toFixed(2)}`, cls: "text-info" };
  return { label: `1:${ratio.toFixed(2)} ⚠️ Bajo`, cls: "text-warning" };
}

export function CryptoTab() {
  const { user } = useAuth();
  const fetchSnap = useServerFn(getCryptoSnapshot);
  const fetchAnalysis = useServerFn(analyzeCrypto);

  const [quotes, setQuotes] = useState<CryptoQuote[]>([]);
  const [market, setMarket] = useState<CryptoMarket | null>(null);
  const [signals, setSignals] = useState<CryptoSignal[]>([]);
  const [loadingSnap, setLoadingSnap] = useState(false);
  const [loadingAi, setLoadingAi] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [view, setView] = useState<"signals" | "trades">("signals");

  const reloadSnap = useCallback(async () => {
    setLoadingSnap(true);
    try {
      const s = await fetchSnap();
      setQuotes(s.quotes);
      setMarket(s.market);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSnap(false);
    }
  }, [fetchSnap]);

  const runAnalysis = useCallback(async () => {
    setLoadingAi(true);
    try {
      const a = await fetchAnalysis();
      setSignals(a.signals);
      setMarket(a.market);
    } catch (e) {
      toast.error("Error análisis crypto: " + (e as Error).message);
    } finally {
      setLoadingAi(false);
    }
  }, [fetchAnalysis]);

  useEffect(() => { reloadSnap(); }, [reloadSnap]);
  useEffect(() => {
    const id = setInterval(reloadSnap, POLL_MS);
    return () => clearInterval(id);
  }, [reloadSnap]);

  const didAuto = useRef(false);
  useEffect(() => {
    if (!quotes.length || didAuto.current) return;
    didAuto.current = true;
    runAnalysis();
  }, [quotes, runAnalysis]);

  // alerts + trades
  const reloadAlerts = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("price_alerts").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setAlerts((data || []) as Alert[]);
  }, [user]);
  const reloadTrades = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("crypto_trades").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
    setTrades((data || []) as Trade[]);
  }, [user]);
  useEffect(() => { reloadAlerts(); reloadTrades(); }, [reloadAlerts, reloadTrades]);

  // alert triggering check
  const triggeredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!alerts.length || !quotes.length) return;
    const priceBy = new Map(quotes.map((q) => [q.ticker, q.price_usd]));
    for (const a of alerts) {
      if (a.is_triggered || triggeredRef.current.has(a.id)) continue;
      const cur = priceBy.get(a.ticker);
      if (!cur) continue;
      const hit = a.direction === "above" ? cur >= Number(a.target_price) : cur <= Number(a.target_price);
      if (hit) {
        triggeredRef.current.add(a.id);
        toast.success(`🔔 ${a.ticker} ${a.direction === "above" ? "subió a" : "bajó a"} ${usd(cur)} (objetivo ${usd(Number(a.target_price))})`);
        supabase.from("price_alerts").update({ is_triggered: true, triggered_at: new Date().toISOString() }).eq("id", a.id).then(() => reloadAlerts());
      }
    }
  }, [alerts, quotes, reloadAlerts]);

  const sigByTicker = useMemo(() => new Map(signals.map((s) => [s.ticker, s])), [signals]);
  const selectedQuote = quotes.find((q) => q.ticker === selected);
  const selectedSig = selected ? sigByTicker.get(selected) : null;

  const topThree = quotes.slice(0, 3);

  const wonTrades = trades.filter((t) => t.status === "won").length;
  const closedTrades = trades.filter((t) => t.status !== "open").length;
  const totalPnl = trades.reduce((a, t) => a + (Number(t.pnl_usd) || 0), 0);
  const winRate = closedTrades > 0 ? (wonTrades / closedTrades) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="bg-card border rounded-xl p-3 shadow-card flex flex-wrap items-center gap-3 text-sm">
        {topThree.map((q) => (
          <div key={q.ticker} className="font-mono px-2.5 py-1 rounded-lg bg-secondary/50 inline-flex items-center gap-2" data-mono>
            <span className="font-bold">{q.ticker}</span>
            <span>{q.price_usd > 0 ? usd(q.price_usd) : "—"}</span>
            {q.change_24h_pct !== 0 && (
              <span className={`text-xs inline-flex items-center gap-0.5 ${q.change_24h_pct >= 0 ? "text-success" : "text-destructive"}`}>
                {q.change_24h_pct >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                {q.change_24h_pct >= 0 ? "+" : ""}{q.change_24h_pct.toFixed(2)}%
              </span>
            )}
          </div>
        ))}
        {market?.fear_greed && (
          <span className={`px-2 py-1 rounded-lg border text-xs font-bold ${fearGreedColor(market.fear_greed.value)}`}>
            Fear&Greed: {market.fear_greed.value} · {market.fear_greed.label}
          </span>
        )}
        {market?.btc_dominance != null && (
          <span className="px-2 py-1 rounded-lg border border-border bg-secondary/30 text-xs font-mono" data-mono>
            BTC Dom: {market.btc_dominance.toFixed(2)}%
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-success">
          <span className="size-1.5 rounded-full bg-success animate-pulse" /> LIVE 24/7
        </span>
        <Button size="sm" variant="ghost" disabled={loadingSnap || loadingAi} onClick={() => { reloadSnap(); runAnalysis(); }}>
          <RefreshCw className={`size-3.5 mr-1 ${loadingSnap || loadingAi ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </div>

      {/* View tabs */}
      <div className="flex gap-2">
        <Button size="sm" variant={view === "signals" ? "default" : "outline"} onClick={() => setView("signals")}>Señales</Button>
        <Button size="sm" variant={view === "trades" ? "default" : "outline"} onClick={() => setView("trades")}>
          Mis trades {trades.length > 0 && <Badge variant="outline" className="ml-1.5 text-[10px]">{trades.length}</Badge>}
        </Button>
      </div>

      {view === "signals" && (
        <div className="grid lg:grid-cols-[1fr_360px] gap-4">
          {/* Table */}
          <div className="bg-card border rounded-xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Crypto</th>
                    <th className="px-3 py-2 text-right">Precio USD</th>
                    <th className="px-3 py-2 text-right">24h%</th>
                    <th className="px-3 py-2 text-center">Señal</th>
                    <th className="px-3 py-2 text-right hidden md:table-cell">Stop</th>
                    <th className="px-3 py-2 text-right hidden md:table-cell">Target</th>
                    <th className="px-3 py-2 text-left hidden lg:table-cell">Plazo</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.length === 0 && (
                    <>
                      {[1,2,3,4,5].map((i) => (
                        <tr key={i}><td colSpan={7} className="p-2"><Skeleton className="h-8 w-full" /></td></tr>
                      ))}
                    </>
                  )}
                  {quotes.map((q) => {
                    const sig = sigByTicker.get(q.ticker);
                    const isSel = selected === q.ticker;
                    const sigCls = sig?.signal === "COMPRAR" ? "bg-success text-background"
                      : sig?.signal === "VENDER" ? "bg-destructive text-destructive-foreground"
                      : sig?.signal === "ESPERAR" ? "bg-warning text-background" : "bg-muted text-muted-foreground";
                    return (
                      <tr key={q.ticker} onClick={() => setSelected(q.ticker)} className={`border-t cursor-pointer hover:bg-secondary/30 transition-colors ${isSel ? "bg-secondary/40" : ""}`}>
                        <td className="px-3 py-3">
                          <div className="font-bold">{q.ticker}</div>
                          <div className="text-xs text-muted-foreground">{q.name}</div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-semibold" data-mono>{q.price_usd > 0 ? usd(q.price_usd) : "—"}</td>
                        <td className={`px-3 py-3 text-right font-mono text-xs ${q.change_24h_pct >= 0 ? "text-success" : "text-destructive"}`} data-mono>
                          {q.change_24h_pct >= 0 ? "+" : ""}{q.change_24h_pct.toFixed(2)}%
                        </td>
                        <td className="px-3 py-3 text-center">
                          {sig ? (
                            <span className={`inline-block px-3 py-1 rounded-md text-xs font-extrabold uppercase tracking-wide ${sigCls}`}>
                              {sig.signal}
                            </span>
                          ) : (
                            <Skeleton className="h-6 w-16 mx-auto" />
                          )}
                          {sig && (
                            <div className="text-[10px] text-muted-foreground mt-1 font-mono" data-mono>
                              entry {usd(sig.entry_price_usd)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-destructive hidden md:table-cell" data-mono>
                          {sig ? usd(sig.stop_price_usd) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-success hidden md:table-cell" data-mono>
                          {sig ? usd(sig.target_price_usd) : "—"}
                        </td>
                        <td className="px-3 py-3 text-left text-xs text-muted-foreground hidden lg:table-cell">
                          {sig?.horizon || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Side panel */}
          <aside className="bg-card border rounded-xl shadow-card p-4 space-y-3 h-fit lg:sticky lg:top-20">
            {!selected || !selectedQuote ? (
              <div className="text-sm text-muted-foreground text-center py-10">
                Hacé click en una crypto para ver detalles, calculadora y alertas.
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-display font-bold text-2xl">{selectedQuote.ticker}</div>
                    <div className="text-xs text-muted-foreground">{selectedQuote.name}</div>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="size-4" />
                  </button>
                </div>
                <div className="font-mono text-2xl font-bold" data-mono>{usd(selectedQuote.price_usd)}</div>
                <div className={`text-xs font-mono ${selectedQuote.change_24h_pct >= 0 ? "text-success" : "text-destructive"}`} data-mono>
                  {selectedQuote.change_24h_pct >= 0 ? "+" : ""}{selectedQuote.change_24h_pct.toFixed(2)}% (24h)
                </div>

                {selectedSig && (
                  <>
                    <div className={`mt-2 p-3 rounded-lg ${selectedSig.signal === "COMPRAR" ? "bg-success/15 border border-success/40" : selectedSig.signal === "VENDER" ? "bg-destructive/15 border border-destructive/40" : "bg-warning/15 border border-warning/40"}`}>
                      <div className="text-xs uppercase font-bold tracking-wide">Orden</div>
                      <div className="text-xl font-display font-bold">{selectedSig.signal} {selectedSig.ticker}</div>
                      <div className="grid grid-cols-3 gap-2 mt-2 text-xs font-mono" data-mono>
                        <div><div className="text-muted-foreground">Entrada</div><div className="font-bold">{usd(selectedSig.entry_price_usd)}</div></div>
                        <div><div className="text-muted-foreground">Stop</div><div className="font-bold text-destructive">{usd(selectedSig.stop_price_usd)} <span className="text-[10px]">({selectedSig.stop_pct.toFixed(1)}%)</span></div></div>
                        <div><div className="text-muted-foreground">Target</div><div className="font-bold text-success">{usd(selectedSig.target_price_usd)} <span className="text-[10px]">(+{selectedSig.target_pct.toFixed(1)}%)</span></div></div>
                      </div>
                      <div className="text-xs mt-2"><span className="text-muted-foreground">Plazo:</span> <span className="font-bold">{selectedSig.horizon}</span> · <span className="text-muted-foreground">Prob:</span> <span className="font-bold">{selectedSig.probability_pct}%</span></div>
                      {(() => {
                        const r = ratioBadge(selectedSig.stop_price_usd, selectedSig.target_price_usd, selectedSig.entry_price_usd);
                        return r ? <div className={`text-xs mt-1 ${r.cls}`}>R/B: {r.label}</div> : null;
                      })()}
                      <p className="text-xs italic mt-2">"{selectedSig.reason}"</p>
                    </div>
                    <PositionCalculator sig={selectedSig} onSaveTrade={async (capital) => {
                      if (!user) return;
                      const { error } = await supabase.from("crypto_trades").insert({
                        user_id: user.id,
                        ticker: selectedSig.ticker,
                        signal: selectedSig.signal,
                        entry_price_usd: selectedSig.entry_price_usd,
                        stop_price_usd: selectedSig.stop_price_usd,
                        target_price_usd: selectedSig.target_price_usd,
                        capital_usd: capital,
                      });
                      if (error) toast.error(error.message);
                      else { toast.success("Trade guardado"); reloadTrades(); }
                    }} />
                  </>
                )}
<CryptoChartLive symbol={`${selectedQuote.ticker}/USD`} ticker={selectedQuote.ticker} />
                <PriceAlertForm ticker={selectedQuote.ticker} currentPrice={selectedQuote.price_usd} userId={user?.id} onCreated={reloadAlerts} />
                <ExistingAlerts alerts={alerts.filter((a) => a.ticker === selectedQuote.ticker)} onDelete={async (id) => {
                  await supabase.from("price_alerts").delete().eq("id", id);
                  reloadAlerts();
                }} />
              </>
            )}
          </aside>
        </div>
      )}

      {view === "trades" && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Trades cerrados" value={`${closedTrades}`} />
            <Stat label="Win rate" value={closedTrades ? `${winRate.toFixed(0)}%` : "—"} />
            <Stat label="P&L acumulado" value={usd(totalPnl)} cls={totalPnl >= 0 ? "text-success" : "text-destructive"} />
          </div>
          <div className="bg-card border rounded-xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Crypto</th>
                    <th className="px-3 py-2 text-left">Señal</th>
                    <th className="px-3 py-2 text-right">Entrada</th>
                    <th className="px-3 py-2 text-right hidden md:table-cell">Capital</th>
                    <th className="px-3 py-2 text-right">P&L</th>
                    <th className="px-3 py-2 text-center">Estado</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {trades.length === 0 && (
                    <tr><td colSpan={7} className="text-center text-muted-foreground py-8">Sin trades guardados todavía. Hacé click en una señal y guardala.</td></tr>
                  )}
                  {trades.map((t) => {
                    const open = t.status === "open";
                    const won = t.status === "won";
                    return (
                      <tr key={t.id} className="border-t">
                        <td className="px-3 py-2 font-bold">{t.ticker}</td>
                        <td className="px-3 py-2 text-xs">{t.signal}</td>
                        <td className="px-3 py-2 text-right font-mono" data-mono>{usd(Number(t.entry_price_usd))}</td>
                        <td className="px-3 py-2 text-right font-mono hidden md:table-cell" data-mono>{usd(Number(t.capital_usd))}</td>
                        <td className={`px-3 py-2 text-right font-mono ${t.pnl_usd != null ? (Number(t.pnl_usd) >= 0 ? "text-success" : "text-destructive") : "text-muted-foreground"}`} data-mono>
                          {t.pnl_usd != null ? `${Number(t.pnl_usd) >= 0 ? "+" : ""}${usd(Number(t.pnl_usd))}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {open && <Badge variant="outline" className="bg-info/15 text-info border-info/30">Abierto</Badge>}
                          {won && <Badge variant="outline" className="bg-success/15 text-success border-success/30 inline-flex items-center gap-1"><CheckCircle2 className="size-3" /> Ganó</Badge>}
                          {t.status === "lost" && <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30 inline-flex items-center gap-1"><XCircle className="size-3" /> Perdió</Badge>}
                          {t.status === "closed" && <Badge variant="outline">Cerrado</Badge>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {open && (
                            <div className="flex gap-1 justify-end">
                              <Button size="sm" variant="outline" className="h-7 text-xs border-success/40 text-success hover:bg-success/10" onClick={async () => {
                                const exit = Number(t.target_price_usd);
                                const pnl = (exit - Number(t.entry_price_usd)) / Number(t.entry_price_usd) * Number(t.capital_usd);
                                const pnl_pct = (exit - Number(t.entry_price_usd)) / Number(t.entry_price_usd) * 100;
                                await supabase.from("crypto_trades").update({ status: "won", exit_price_usd: exit, pnl_usd: pnl, pnl_pct, closed_at: new Date().toISOString() }).eq("id", t.id);
                                reloadTrades();
                              }}>Ganó</Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10" onClick={async () => {
                                const exit = Number(t.stop_price_usd);
                                const pnl = (exit - Number(t.entry_price_usd)) / Number(t.entry_price_usd) * Number(t.capital_usd);
                                const pnl_pct = (exit - Number(t.entry_price_usd)) / Number(t.entry_price_usd) * 100;
                                await supabase.from("crypto_trades").update({ status: "lost", exit_price_usd: exit, pnl_usd: pnl, pnl_pct, closed_at: new Date().toISOString() }).eq("id", t.id);
                                reloadTrades();
                              }}>Perdió</Button>
                            </div>
                          )}
                          {!open && (
                            <button onClick={async () => { await supabase.from("crypto_trades").delete().eq("id", t.id); reloadTrades(); }} className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="bg-card border rounded-xl p-4 shadow-card">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-display font-bold mt-1 font-mono ${cls || ""}`} data-mono>{value}</div>
    </div>
  );
}

function PositionCalculator({ sig, onSaveTrade }: { sig: CryptoSignal; onSaveTrade: (capital: number) => void }) {
  const [capStr, setCapStr] = useState("500");
  const cap = Number(capStr.replace(/[^\d.]/g, "")) || 0;
  const units = sig.entry_price_usd > 0 ? cap / sig.entry_price_usd : 0;
  const winUsd = (sig.target_price_usd - sig.entry_price_usd) * units;
  const loseUsd = (sig.stop_price_usd - sig.entry_price_usd) * units;
  const winPct = sig.target_pct;
  const losePct = sig.stop_pct;
  const ratio = ratioBadge(sig.stop_price_usd, sig.target_price_usd, sig.entry_price_usd);

  return (
    <div className="border-t pt-3">
      <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">💵 Calculadora de posición</div>
      <label className="text-xs text-muted-foreground">Capital a invertir (USD)</label>
      <Input inputMode="decimal" value={capStr} onChange={(e) => setCapStr(e.target.value)} className="font-mono mt-1" />
      {cap > 0 && (
        <div className="mt-3 space-y-1.5 text-sm font-mono" data-mono>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Comprás</span>
            <span className="text-foreground font-bold">{units.toFixed(units < 1 ? 6 : 4)} {sig.ticker}</span>
          </div>
          <div className="flex items-center justify-between bg-success/10 rounded-lg px-3 py-2">
            <span className="text-xs text-muted-foreground">Si llega al target</span>
            <span className="font-bold text-success">+{usd(winUsd)} <span className="text-xs">(+{winPct.toFixed(1)}%)</span></span>
          </div>
          <div className="flex items-center justify-between bg-destructive/10 rounded-lg px-3 py-2">
            <span className="text-xs text-muted-foreground">Si llega al stop</span>
            <span className="font-bold text-destructive">{usd(loseUsd)} <span className="text-xs">({losePct.toFixed(1)}%)</span></span>
          </div>
          {ratio && <div className={`text-xs ${ratio.cls}`}>Riesgo/beneficio: {ratio.label}</div>}
          <Button size="sm" className="w-full mt-2" onClick={() => onSaveTrade(cap)}>
            Guardar como trade
          </Button>
        </div>
      )}
    </div>
  );
}

function PriceAlertForm({ ticker, currentPrice, userId, onCreated }: { ticker: string; currentPrice: number; userId?: string; onCreated: () => void }) {
  const [target, setTarget] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const submit = async () => {
    if (!userId) return toast.error("Iniciá sesión");
    const t = Number(target);
    if (!t || t <= 0) return toast.error("Precio inválido");
    const { error } = await supabase.from("price_alerts").insert({ user_id: userId, ticker, target_price: t, direction });
    if (error) return toast.error(error.message);
    setTarget("");
    toast.success(`Alerta creada: ${ticker} ${direction === "above" ? "≥" : "≤"} ${usd(t)}`);
    onCreated();
  };
  return (
    <div className="border-t pt-3">
      <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 inline-flex items-center gap-1">
        <Bell className="size-3" /> Alerta de precio
      </div>
      <div className="flex gap-2">
        <select value={direction} onChange={(e) => setDirection(e.target.value as "above" | "below")} className="bg-secondary/40 border border-border rounded-md px-2 text-xs h-9">
          <option value="above">Sube a</option>
          <option value="below">Baja a</option>
        </select>
        <Input inputMode="decimal" placeholder={currentPrice ? String(Math.round(currentPrice)) : "USD"} value={target} onChange={(e) => setTarget(e.target.value)} className="font-mono h-9 flex-1" />
        <Button size="sm" onClick={submit} className="h-9">Crear</Button>
      </div>
    </div>
  );
}

function ExistingAlerts({ alerts, onDelete }: { alerts: Alert[]; onDelete: (id: string) => void }) {
  if (!alerts.length) return null;
  return (
    <div className="border-t pt-3">
      <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Alertas activas</div>
      <ul className="space-y-1 text-xs">
        {alerts.map((a) => (
          <li key={a.id} className="flex items-center justify-between bg-secondary/30 rounded px-2 py-1 font-mono" data-mono>
            <span>
              {a.direction === "above" ? "≥" : "≤"} {usd(Number(a.target_price))}
              {a.is_triggered && <span className="ml-2 text-success">✓ disparada</span>}
            </span>
            <button onClick={() => onDelete(a.id)} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="size-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
