import React, { createContext, useContext, useMemo, useState } from "react";
import { findDemoUser, type DemoUserRole } from "./demoAuth";

type AuthState = {
  username: string;
  displayName: string;
  role: DemoUserRole;
};

type AuthContextValue = {
  user: AuthState | null;
  isAuthed: boolean;
  signIn: (username: string, password: string) => { ok: boolean; message?: string };
  signOut: () => void;
  hasRole: (...roles: DemoUserRole[]) => boolean;
};

const STORAGE_KEY = "ad_demo_auth";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function isValidRole(role: unknown): role is DemoUserRole {
  return role === "admin" || role === "order_user";
}

function readStored(): AuthState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.username !== "string") return null;
    if (typeof parsed.displayName !== "string") return null;
    if (!isValidRole(parsed.role)) return null;
    return { username: parsed.username, displayName: parsed.displayName, role: parsed.role };
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
        const found = findDemoUser(username, password);
        if (!found) {
          return { ok: false, message: "帳號或密碼錯誤" };
        }
        const next = { username: found.username, displayName: found.displayName, role: found.role };
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
      hasRole: (...roles: DemoUserRole[]) => !!user && roles.includes(user.role),
    };
  }, [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
