import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
export const publicAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

if (!supabaseUrl || !publicAnonKey) {
  if (import.meta.env.DEV) {
    console.warn(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.",
    );
  }
  throw new Error("Missing Supabase environment configuration.");
}

const normalizedSupabaseUrl = supabaseUrl.replace(/\/+$/, "");
export const projectId = new URL(normalizedSupabaseUrl).hostname.split(".")[0];
export const apiBase = `${normalizedSupabaseUrl}/functions/v1/make-server-ee0b9b9f`;

export const supabase = createClient(normalizedSupabaseUrl, publicAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
