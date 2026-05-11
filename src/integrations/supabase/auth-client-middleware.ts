// Client middleware: attaches the current Supabase access token as the
// `Authorization` header so server functions guarded by `requireSupabaseAuth`
// receive a valid bearer token. Without this, every authenticated server-fn
// call returns 401 (which TanStack serializes as `[object Response]` on the
// client and triggers the blank-screen error capture).
import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "./client";

export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }
);
