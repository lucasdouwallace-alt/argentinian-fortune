import { createClient } from "@supabase/supabase-js";

const MARKET_TTL_MS = 2 * 60 * 60 * 1000;
const CRYPTO_TTL_MS = 1 * 60 * 60 * 1000;

function getSupabase() {
  const url = import.meta.env.VITE_SUPABASE_URL ?? "";
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
  return createClient(url, key);
}

export type AnalysisType = "market" | "crypto";

export async function getCachedAnalysis<T>(
  userId: string,
  type: AnalysisType,
): Promise<{ data: T; age_ms: number } | null> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("analysis_cache")
      .select("data, created_at")
      .eq("user_id", userId)
      .eq("analysis_type", type)
      .single();

    if (error || !data) return null;

    const age_ms = Date.now() - new Date(data.created_at).getTime();
    const ttl = type === "market" ? MARKET_TTL_MS : CRYPTO_TTL_MS;
    if (age_ms > ttl) return null;

    return { data: data.data as T, age_ms };
  } catch {
    return null;
  }
}

export async function setCachedAnalysis<T>(
  userId: string,
  type: AnalysisType,
  analysis: T,
): Promise<void> {
  try {
    const sb = getSupabase();
    await sb.from("analysis_cache").upsert(
      {
        user_id: userId,
        analysis_type: type,
        data: analysis,
        created_at: new Date().toISOString(),
      },
      { onConflict: "user_id,analysis_type" },
    );
  } catch (e) {
    console.error("[analysisCache] write failed", e);
  }
}
