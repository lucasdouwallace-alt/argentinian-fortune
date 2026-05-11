// Catálogo de tickers que el Oráculo monitorea.
// Categorías: tech, fin, energy, health, consumer, etf, arg, crypto (placeholder).

export type TickerCategory = "tech" | "fin" | "energy" | "health" | "consumer" | "etf" | "arg" | "crypto";

export type TickerInfo = {
  symbol: string;
  name: string;
  category: TickerCategory;
};

export const TICKER_CATALOG: TickerInfo[] = [
  // CEDEARs Tech
  { symbol: "AAPL", name: "Apple", category: "tech" },
  { symbol: "MSFT", name: "Microsoft", category: "tech" },
  { symbol: "GOOGL", name: "Alphabet", category: "tech" },
  { symbol: "AMZN", name: "Amazon", category: "tech" },
  { symbol: "META", name: "Meta Platforms", category: "tech" },
  { symbol: "NVDA", name: "NVIDIA", category: "tech" },
  { symbol: "TSLA", name: "Tesla", category: "tech" },
  { symbol: "NFLX", name: "Netflix", category: "tech" },
  { symbol: "PYPL", name: "PayPal", category: "tech" },
  { symbol: "INTC", name: "Intel", category: "tech" },
  { symbol: "AMD", name: "AMD", category: "tech" },
  { symbol: "CRM", name: "Salesforce", category: "tech" },
  { symbol: "ORCL", name: "Oracle", category: "tech" },
  { symbol: "ADBE", name: "Adobe", category: "tech" },
  { symbol: "QCOM", name: "Qualcomm", category: "tech" },
  { symbol: "PLTR", name: "Palantir", category: "tech" },
  // CEDEARs Finanzas
  { symbol: "JPM", name: "JPMorgan", category: "fin" },
  { symbol: "BAC", name: "Bank of America", category: "fin" },
  { symbol: "GS", name: "Goldman Sachs", category: "fin" },
  { symbol: "MS", name: "Morgan Stanley", category: "fin" },
  { symbol: "V", name: "Visa", category: "fin" },
  { symbol: "MA", name: "Mastercard", category: "fin" },
  { symbol: "AXP", name: "American Express", category: "fin" },
  // CEDEARs Energía
  { symbol: "XOM", name: "Exxon Mobil", category: "energy" },
  { symbol: "CVX", name: "Chevron", category: "energy" },
  { symbol: "SLB", name: "Schlumberger", category: "energy" },
  { symbol: "BP", name: "BP", category: "energy" },
  // CEDEARs Salud
  { symbol: "JNJ", name: "Johnson & Johnson", category: "health" },
  { symbol: "PFE", name: "Pfizer", category: "health" },
  { symbol: "MRK", name: "Merck", category: "health" },
  { symbol: "ABBV", name: "AbbVie", category: "health" },
  // CEDEARs Consumo
  { symbol: "WMT", name: "Walmart", category: "consumer" },
  { symbol: "COST", name: "Costco", category: "consumer" },
  { symbol: "MCD", name: "McDonald's", category: "consumer" },
  { symbol: "KO", name: "Coca-Cola", category: "consumer" },
  { symbol: "PEP", name: "PepsiCo", category: "consumer" },
  { symbol: "NKE", name: "Nike", category: "consumer" },
  { symbol: "DIS", name: "Disney", category: "consumer" },
  // ETFs
  { symbol: "SPY", name: "S&P 500 ETF", category: "etf" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", category: "etf" },
  { symbol: "GLD", name: "Gold ETF", category: "etf" },
  { symbol: "SLV", name: "Silver ETF", category: "etf" },
  { symbol: "USO", name: "Oil ETF", category: "etf" },
  // Argentinas (ADR)
  { symbol: "VIST", name: "Vista Energy", category: "arg" },
  { symbol: "MELI", name: "MercadoLibre", category: "arg" },
  { symbol: "BMA", name: "Banco Macro", category: "arg" },
  { symbol: "GGAL", name: "Grupo Galicia", category: "arg" },
  { symbol: "YPF", name: "YPF", category: "arg" },
  { symbol: "PAM", name: "Pampa Energía", category: "arg" },
  { symbol: "TGS", name: "Transp. Gas del Sur", category: "arg" },
  { symbol: "SUPV", name: "Grupo Supervielle", category: "arg" },
  { symbol: "LOMA", name: "Loma Negra", category: "arg" },
  { symbol: "CRESY", name: "Cresud", category: "arg" },
  { symbol: "IRS", name: "IRSA", category: "arg" },
  { symbol: "CEPU", name: "Central Puerto", category: "arg" },
  { symbol: "EDN", name: "Edenor", category: "arg" },
];

// TODO: agregar BTC, ETH, SOL, BNB via Alpaca crypto endpoint
// Alpaca soporta crypto: wss://stream.data.alpaca.markets/v2/crypto
// No requiere cambios de API key

export const ALL_TICKERS = TICKER_CATALOG.map((t) => t.symbol);
export const TICKER_NAME = Object.fromEntries(TICKER_CATALOG.map((t) => [t.symbol, t.name]));
export const TICKER_CATEGORY = Object.fromEntries(TICKER_CATALOG.map((t) => [t.symbol, t.category]));

export const CATEGORY_LABELS: Record<TickerCategory, string> = {
  tech: "Tech",
  fin: "Finanzas",
  energy: "Energía",
  health: "Salud",
  consumer: "Consumo",
  etf: "ETFs",
  arg: "Argentina",
  crypto: "Crypto",
};
