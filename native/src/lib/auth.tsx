import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { siteApi } from "./api";
import { dbCode } from "./errors";
import { registerForPush, unregisterPush } from "./push";
import { supabase } from "./supabase";

export interface Profile {
  id: string;
  display_name: string;
  username: string | null;
  avatar_path: string | null;
  onboarded_at: string | null;
}

interface SignInResult {
  error?: string;
  field?: { name: string; error: string } | null;
  secondStep?: boolean;
}

interface Auth {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  /** A second step (authenticator app) is still owed for this session. */
  needsSecondStep: boolean;
  signIn: (field: "phone" | "email", login: string, password: string) => Promise<SignInResult>;
  verifySecondStep: (code: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /** A session the site handed over (after a sign-up or a reset): kept, then the profile loaded. */
  adoptSession: (tokens: { accessToken: string; refreshToken: string }) => Promise<boolean>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth outside AuthProvider");
  return auth;
}

/**
 * The member's session. Signing in goes through the site (/api/app/sign-in:
 * its limits on wrong passwords, its logging); the session then lives on the
 * phone's keychain and talks to the database directly, under its rules.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [needsSecondStep, setNeedsSecondStep] = useState(false);

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase().from("profiles").select("id, display_name, username, avatar_path, onboarded_at").eq("id", userId).maybeSingle();
    setProfile((data as Profile | null) ?? null);
  }, []);

  const checkLevel = useCallback(async () => {
    const { data } = await supabase().auth.mfa.getAuthenticatorAssuranceLevel();
    const owed = Boolean(data && data.nextLevel === "aal2" && data.currentLevel !== "aal2");
    setNeedsSecondStep(owed);
    return owed;
  }, []);

  useEffect(() => {
    const client = supabase();
    let alive = true;
    void client.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (data.session) {
        const owed = await checkLevel();
        if (!owed) await loadProfile(data.session.user.id);
      }
      setReady(true);
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) setProfile(null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [checkLevel, loadProfile]);

  const signIn = useCallback<Auth["signIn"]>(
    async (field, login, password) => {
      const res = await siteApi<{ accessToken?: string; refreshToken?: string; secondStep?: boolean }>("/api/app/sign-in", { [field]: login, password });
      if (res.error || !res.accessToken || !res.refreshToken) return { error: res.error ?? "generic", field: res.field };
      const { data, error } = await supabase().auth.setSession({ access_token: res.accessToken, refresh_token: res.refreshToken });
      if (error || !data.session) return { error: "generic" };
      if (res.secondStep) {
        setNeedsSecondStep(true);
        return { secondStep: true };
      }
      setNeedsSecondStep(false);
      await loadProfile(data.session.user.id);
      void registerForPush();
      return {};
    },
    [loadProfile],
  );

  const verifySecondStep = useCallback<Auth["verifySecondStep"]>(
    async (code) => {
      const client = supabase();
      const { data: factors } = await client.auth.mfa.listFactors();
      const factor = factors?.totp?.[0];
      if (!factor) return "generic";
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\s/g, "") });
      if (error) return "invalid_code";
      setNeedsSecondStep(false);
      const { data } = await client.auth.getSession();
      if (data.session) await loadProfile(data.session.user.id);
      void registerForPush();
      return null;
    },
    [loadProfile],
  );

  const signOut = useCallback(async () => {
    await unregisterPush().catch(() => undefined);
    await supabase().auth.signOut({ scope: "local" });
    setProfile(null);
    setNeedsSecondStep(false);
  }, []);

  const adoptSession = useCallback<Auth["adoptSession"]>(
    async ({ accessToken, refreshToken }) => {
      const { data, error } = await supabase().auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (error || !data.session) return false;
      setNeedsSecondStep(false);
      await loadProfile(data.session.user.id);
      void registerForPush();
      return true;
    },
    [loadProfile],
  );

  const refreshProfile = useCallback(async () => {
    if (session) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = useMemo<Auth>(
    () => ({ ready, session, profile, needsSecondStep, signIn, verifySecondStep, signOut, refreshProfile, adoptSession }),
    [ready, session, profile, needsSecondStep, signIn, verifySecondStep, signOut, refreshProfile, adoptSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { dbCode };
