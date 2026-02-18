import React, { createContext, useContext, useMemo, useState } from "react";
import { DEMO_USER } from "./demoAuth";

type AuthState = {
  username: string;
  displayName: string;
};

type AuthContextValue = {
  user: AuthState | null;
  isAuthed: boolean;
  signIn: (username: string, password: string) => { ok: boolean; message?: string };
  signOut: () => void;
};

const STORAGE_KEY = "ad_demo_auth";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStored(): AuthState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.username !== "string") return null;
    if (typeof parsed.displayName !== "string") return null;
    return { username: parsed.username, displayName: parsed.displayName };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthState | null>(() => readStored());

  const value = useMemo<AuthContextValue>(() => {
    return {
      user,
      isAuthed: !!user,
      signIn: (username: string, password: string) => {
        if (username !== DEMO_USER.username || password !== DEMO_USER.password) {
          return { ok: false, message: "帳號或密碼錯誤（Demo）" };
        }
        const next = { username, displayName: DEMO_USER.displayName };
        setUser(next);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return { ok: true };
      },
      signOut: () => {
        setUser(null);
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
      },
    };
  }, [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

