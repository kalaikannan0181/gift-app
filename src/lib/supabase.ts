import { createClient } from "@supabase/supabase-js";

const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const configuredAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

const fallbackSupabaseUrl = "https://kqdhboohqqimrwbksemm.supabase.co";
const fallbackAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxZGhib29ocXFpbXJ3YmtzZW1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyNTc4NzMsImV4cCI6MjEwNjgzMzg3M30.XTTSoZ4oejA8v4T1s_cU4Zwhow5YvVPk1o0SBL4ptxQ";

if (import.meta.env.DEV && (!configuredSupabaseUrl || !configuredAnonKey)) {
  console.warn(
    "Supabase Vite environment variables are missing; using the configured public project fallback.",
  );
}

export const supabaseUrl = configuredSupabaseUrl || fallbackSupabaseUrl;
export const publicAnonKey = configuredAnonKey || fallbackAnonKey;

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
