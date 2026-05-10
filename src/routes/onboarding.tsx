import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { DEFAULT_PORTFOLIO } from "@/lib/portfolio";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Configurá tu perfil · Oráculo" }] }),
  component: OnboardingPage,
});

const RISK = [
  { v: "conservador", t: "Conservador", d: "Priorizo no perder" },
  { v: "moderado", t: "Moderado", d: "Equilibrio riesgo/retorno" },
  { v: "agresivo", t: "Agresivo", d: "Busco máximo retorno" },
];
const HORIZON = [
  { v: "corto", t: "1 a 3 meses" },
  { v: "medio", t: "3 a 12 meses" },
  { v: "largo", t: "Más de 1 año" },
];

function OnboardingPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const [capital, setCapital] = useState(200000);
  const [risk, setRisk] = useState("moderado");
  const [horizon, setHorizon] = useState("medio");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const finish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error: e1 } = await supabase.from("profiles").update({
        risk_tolerance: risk,
        horizon,
        monthly_capital_ars: capital,
        onboarding_completed: true,
        disclaimer_accepted_at: new Date().toISOString(),
      }).eq("id", user.id);
      if (e1) throw e1;

      const rows = DEFAULT_PORTFOLIO.map(p => ({ ...p, user_id: user.id }));
      const { error: e2 } = await supabase.from("portfolio_assets").insert(rows);
      if (e2) throw e2;

      toast.success("Perfil listo. Cargando dashboard...");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-glow flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-card border rounded-xl p-8 shadow-card">
        <div className="flex items-center gap-2 mb-6">
          <Sparkles className="size-5 text-primary" />
          <span className="font-display font-bold">Oráculo</span>
          <span className="ml-auto text-xs text-muted-foreground">Paso {step + 1} de 4</span>
        </div>

        {step === 0 && (
          <div>
            <h2 className="text-2xl font-display font-bold mb-3">Antes de empezar</h2>
            <div className="text-sm text-muted-foreground space-y-2 mb-6 leading-relaxed">
              <p>Esta app usa IA para analizar mercados financieros. <strong className="text-foreground">No constituye asesoramiento financiero profesional.</strong></p>
              <p>Los análisis son estimaciones que pueden ser incorrectos. Toda decisión de inversión es tu responsabilidad.</p>
              <p>Invertir conlleva riesgo de pérdida total del capital.</p>
            </div>
            <label className="flex items-start gap-3 p-4 border rounded-lg cursor-pointer hover:bg-secondary/50">
              <Checkbox checked={accepted} onCheckedChange={(c) => setAccepted(!!c)} className="mt-0.5" />
              <span className="text-sm">Entiendo y acepto que esta app es solo informativa.</span>
            </label>
            <Button disabled={!accepted} onClick={() => setStep(1)} className="w-full mt-6">Continuar</Button>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="text-2xl font-display font-bold mb-2">Capital mensual</h2>
            <p className="text-sm text-muted-foreground mb-6">¿Cuánto podés destinar a invertir cada mes?</p>
            <div className="text-4xl font-display font-bold text-center mb-6 text-primary" data-mono>
              ARS ${capital.toLocaleString("es-AR")}
            </div>
            <Slider value={[capital]} onValueChange={(v) => setCapital(v[0])} min={50000} max={5000000} step={50000} />
            <div className="flex justify-between text-xs text-muted-foreground mt-2"><span>$50k</span><span>$5M</span></div>
            <div className="flex gap-2 mt-8">
              <Button variant="outline" onClick={() => setStep(0)} className="flex-1">Atrás</Button>
              <Button onClick={() => setStep(2)} className="flex-1">Continuar</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-2xl font-display font-bold mb-6">Tolerancia al riesgo</h2>
            <div className="space-y-2 mb-6">
              {RISK.map(r => (
                <button key={r.v} onClick={() => setRisk(r.v)}
                  className={`w-full text-left p-4 border rounded-lg transition ${risk === r.v ? "border-primary bg-primary/5" : "hover:bg-secondary/50"}`}>
                  <div className="font-medium">{r.t}</div>
                  <div className="text-sm text-muted-foreground">{r.d}</div>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Atrás</Button>
              <Button onClick={() => setStep(3)} className="flex-1">Continuar</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-2xl font-display font-bold mb-6">Horizonte</h2>
            <div className="grid grid-cols-3 gap-2 mb-6">
              {HORIZON.map(h => (
                <button key={h.v} onClick={() => setHorizon(h.v)}
                  className={`p-4 border rounded-lg text-sm transition ${horizon === h.v ? "border-primary bg-primary/5" : "hover:bg-secondary/50"}`}>
                  {h.t}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1">Atrás</Button>
              <Button onClick={finish} disabled={saving} className="flex-1">
                {saving ? "Guardando..." : "Empezar"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
