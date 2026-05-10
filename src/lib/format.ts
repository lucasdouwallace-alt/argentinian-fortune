export const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);

export const ars = (n: number) =>
  "$" + new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n || 0);

export const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n || 0).toFixed(2)}%`;

export const timeAgo = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)}m`;
  return `hace ${Math.floor(s / 3600)}h`;
};
