// Tipos y funciones de indicadores técnicos (Alpaca fallback)

export type Technicals = {
  rsi: number | null;
  ma20: number;
  aboveMA20: boolean;
  relativeVolume: number;
  volumeLabel: "alto" | "normal" | "bajo";
  change5dPct: number | null;
};

type TickerCaps = {
  categoryLabel: string;
  slMax: number;
  tpMax: number;
};

export function capsForTicker(ticker: string): TickerCaps {
  const etfs = ["SPY","QQQ","GLD","SLV","USO"];
  const techStable = ["AAPL","MSFT","GOOGL","AMZN","META","NFLX","ORCL","ADBE","CRM","PYPL","INTC","QCOM"];
  const techVolatile = ["NVDA","TSLA","PLTR","AMD"];
  const arg = ["VIST","MELI","BMA","GGAL","YPF","PAM","TGS","SUPV","LOMA","CRESY","IRS","CEPU","EDN","ERCA"];
  const energy = ["XOM","CVX","SLB","BP"];
  const finance = ["JPM","BAC","GS","MS","V","MA","AXP"];
  const health = ["JNJ","PFE","MRK","ABBV"];
  const consumer = ["WMT","COST","MCD","KO","PEP","NKE","DIS"];

  if (etfs.includes(ticker)) return { categoryLabel: "ETF", slMax: 4, tpMax: 5 };
  if (techVolatile.includes(ticker)) return { categoryLabel: "Tech Volátil", slMax: 10, tpMax: 12 };
  if (techStable.includes(ticker)) return { categoryLabel: "Tech", slMax: 6, tpMax: 7 };
  if (arg.includes(ticker)) return { categoryLabel: "Argentina", slMax: 9, tpMax: 15 };
  if (energy.includes(ticker)) return { categoryLabel: "Energía", slMax: 7, tpMax: 9 };
  if (finance.includes(ticker)) return { categoryLabel: "Finanzas", slMax: 6, tpMax: 8 };
  if (health.includes(ticker)) return { categoryLabel: "Salud", slMax: 6, tpMax: 8 };
  if (consumer.includes(ticker)) return { categoryLabel: "Consumo", slMax: 5, tpMax: 7 };
  return { categoryLabel: "General", slMax: 7, tpMax: 10 };
}
