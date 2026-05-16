import { useEffect, useRef } from "react";

const TV_SYMBOL: Record<string, string> = {
  BTC: "BINANCE:BTCUSDT", ETH: "BINANCE:ETHUSDT", SOL: "BINANCE:SOLUSDT",
  XRP: "BINANCE:XRPUSDT", ADA: "BINANCE:ADAUSDT", AVAX: "BINANCE:AVAXUSDT",
  DOGE: "BINANCE:DOGEUSDT", LINK: "BINANCE:LINKUSDT", LTC: "BINANCE:LTCUSDT",
  UNI: "BINANCE:UNIUSDT", DOT: "BINANCE:DOTUSDT", BCH: "BINANCE:BCHUSDT",
  ETC: "BINANCE:ETCUSDT", XLM: "BINANCE:XLMUSDT", AAVE: "BINANCE:AAVEUSDT",
  ALGO: "BINANCE:ALGOUSDT", MATIC: "BINANCE:MATICUSDT", ATOM: "BINANCE:ATOMUSDT",
  FIL: "BINANCE:FILUSDT",
  // Acciones
  AAPL: "NASDAQ:AAPL", MSFT: "NASDAQ:MSFT", GOOGL: "NASDAQ:GOOGL",
  AMZN: "NASDAQ:AMZN", META: "NASDAQ:META", NVDA: "NASDAQ:NVDA",
  TSLA: "NASDAQ:TSLA", NFLX: "NASDAQ:NFLX", PYPL: "NASDAQ:PYPL",
  INTC: "NASDAQ:INTC", AMD: "NASDAQ:AMD", CRM: "NYSE:CRM",
  ORCL: "NYSE:ORCL", ADBE: "NASDAQ:ADBE", QCOM: "NASDAQ:QCOM",
  PLTR: "NYSE:PLTR", JPM: "NYSE:JPM", BAC: "NYSE:BAC",
  GS: "NYSE:GS", MS: "NYSE:MS", V: "NYSE:V", MA: "NYSE:MA",
  AXP: "NYSE:AXP", XOM: "NYSE:XOM", CVX: "NYSE:CVX",
  SLB: "NYSE:SLB", BP: "NYSE:BP", JNJ: "NYSE:JNJ",
  PFE: "NYSE:PFE", MRK: "NYSE:MRK", ABBV: "NYSE:ABBV",
  WMT: "NYSE:WMT", COST: "NASDAQ:COST", MCD: "NYSE:MCD",
  KO: "NYSE:KO", PEP: "NASDAQ:PEP", NKE: "NYSE:NKE",
  DIS: "NYSE:DIS", SPY: "AMEX:SPY", QQQ: "NASDAQ:QQQ",
  GLD: "AMEX:GLD", SLV: "AMEX:SLV", USO: "AMEX:USO",
  VIST: "NYSE:VIST", MELI: "NASDAQ:MELI", BMA: "NYSE:BMA",
  GGAL: "NASDAQ:GGAL", YPF: "NYSE:YPF", PAM: "NYSE:PAM",
  TGS: "NYSE:TGS", SUPV: "NYSE:SUPV", LOMA: "NYSE:LOMA",
  CRESY: "NASDAQ:CRESY", IRS: "NYSE:IRS", CEPU: "NYSE:CEPU", EDN: "NYSE:EDN",
};

type Interval = "1" | "15" | "60" | "240" | "D" | "W";
const INTERVAL_LABEL: Record<Interval, string> = {
  "1": "1m", "15": "15m", "60": "1H", "240": "4H", "D": "1D", "W": "1W",
};

export function TradingViewChart({ ticker }: { ticker: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const symbol = TV_SYMBOL[ticker] || ticker;

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: "60",
      timezone: "America/Argentina/Buenos_Aires",
      theme: "dark",
      style: "1",
      locale: "es",
      enable_publishing: false,
      backgroundColor: "rgba(0,0,0,0)",
      gridColor: "rgba(255,255,255,0.04)",
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      calendar: false,
      studies: ["RSI@tv-basicstudies", "MACD@tv-basicstudies"],
      support_host: "https://www.tradingview.com",
    });

    const wrapper = document.createElement("div");
    wrapper.className = "tradingview-widget-container__widget";
    wrapper.style.height = "100%";
    wrapper.style.width = "100%";
    containerRef.current.appendChild(wrapper);
    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [symbol]);

  return (
    <div className="bg-secondary/10 border rounded-xl overflow-hidden" style={{ height: 420 }}>
      <div
        ref={containerRef}
        className="tradingview-widget-container"
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
}
