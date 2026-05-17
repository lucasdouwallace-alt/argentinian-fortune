import { capsForTicker } from "./technicals";

type SignalInput = {
  signal: "COMPRAR" | "VENDER" | "MANTENER" | "ESPERAR";
  probability_pct: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  target_adjusted?: boolean;
};

export function validateSignal(input: SignalInput, ticker: string): SignalInput & { target_adjusted: boolean } {
  const caps = capsForTicker(ticker);
  let { stop_loss_pct, take_profit_pct } = input;
  let target_adjusted = input.target_adjusted ?? false;

  if (take_profit_pct > caps.tpMax) {
    take_profit_pct = caps.tpMax;
    target_adjusted = true;
  }
  if (stop_loss_pct > caps.slMax) {
    stop_loss_pct = caps.slMax;
    target_adjusted = true;
  }
  if (stop_loss_pct <= 0) stop_loss_pct = caps.slMax * 0.7;
  if (take_profit_pct <= 0) take_profit_pct = caps.tpMax * 0.7;

  return { ...input, stop_loss_pct, take_profit_pct, target_adjusted };
}
