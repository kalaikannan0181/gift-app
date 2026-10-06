import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";

type AuthState = {
  isAdmin: boolean;
  isReady: boolean;
};

const AuthContext = createContext<AuthState>({ isAdmin: false, isReady: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    isAdmin: false,
    isReady: false,
  });

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthState({
        isAdmin: session?.user.app_metadata?.role === "admin",
        isReady: true,
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={authState}>{children}</AuthContext.Provider>;
}

export function useAdminAuth() {
  return useContext(AuthContext);
}