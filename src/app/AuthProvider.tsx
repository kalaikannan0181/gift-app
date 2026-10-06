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
    } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthState((current) => {
        const isAdminSession =
          session?.user.app_metadata?.role === "admin";
        if (event === "SIGNED_IN") {
          return { isAdmin: isAdminSession, isReady: true };
        }
        if (event === "INITIAL_SESSION" || event === "SIGNED_OUT") {
          return { isAdmin: false, isReady: true };
        }
        return {
          isAdmin: current.isAdmin && isAdminSession,
          isReady: true,
        };
      });
    });

    let active = true;
    void supabase.auth.getSession().then(({ error }) => {
      if (error) {
        console.error("Unable to check the Supabase session:", error);
      }
      if (active) {
        setAuthState((current) => ({ ...current, isReady: true }));
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={authState}>{children}</AuthContext.Provider>;
}

export function useAdminAuth() {
  return useContext(AuthContext);
}