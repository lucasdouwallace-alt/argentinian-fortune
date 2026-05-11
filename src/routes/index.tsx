import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Sparkles, TrendingUp, Brain, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Oráculo · Monitor de Inversiones 24/7" },
      { name: "description", content: "Análisis bursátil con IA, precios en tiempo real de Alpaca y conversión a ARS con CCL." },
      { property: "og:title", content: "Oráculo · Monitor de Inversiones 24/7" },
      { property: "og:description", content: "Tu asesor IA para CEDEARs y ADRs argentinos." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate({ to: "/dashboard" });
  }, [loading, user, navigate]);

  return (
    <div className="min-h-screen bg-glow">
      <header className="max-w-6xl mx-auto px-4 h-16 flex items-center">
        <Link to="/" className="flex items-center gap-2">
          <Sparkles className="size-6 text-primary" />
          <span className="font-display font-bold text-xl">Oráculo</span>
        </Link>
        <Link to="/auth" className="ml-auto">
          <Button variant="outline" size="sm">Ingresar</Button>
        </Link>
      </header>

      <main className="max-w-4xl mx-auto px-4 pt-16 pb-24 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-card text-xs text-muted-foreground mb-6">
          <span className="pulse-dot" />
          Datos en tiempo real · Análisis IA · 100% gratis
        </div>
        <h1 className="text-4xl md:text-6xl font-display font-bold tracking-tight leading-[1.05]">
          El Oráculo te dice <span className="text-primary">exactamente qué comprar</span><br />
          y qué vender.
        </h1>
        <p className="text-lg text-muted-foreground mt-6 max-w-2xl mx-auto">
          No es un broker. No es un simulador. Es un vidente financiero con datos reales
          de mercado y análisis de IA. Sin tecnicismos.
        </p>
        <div className="flex gap-3 justify-center mt-8">
          <Link to="/auth">
            <Button size="lg" className="px-8">Empezar gratis</Button>
          </Link>
        </div>

        <section className="grid md:grid-cols-3 gap-4 mt-20 text-left">
          <Feature icon={TrendingUp} title="Precios en vivo" desc="Cotizaciones reales de NYSE/NASDAQ vía Alpaca, convertidas a ARS con CCL al toque." />
          <Feature icon={Brain} title="Señales IA" desc="Gemini analiza el contexto macro y te dice qué hacer con cada activo." />
          <Feature icon={ShieldCheck} title="Tu cartera, tus reglas" desc="Stop loss y take profit configurables. Vos decidís cuándo entrar y cuándo salir." />
        </section>
      </main>
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: typeof TrendingUp; title: string; desc: string }) {
  return (
    <div className="bg-card border rounded-xl p-5 shadow-card">
      <Icon className="size-5 text-primary mb-3" />
      <h3 className="font-display font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
