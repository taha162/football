import { SITE_URL } from "./config";
import { supabase } from "./supabase";

/** The site's endpoints for the app (/api/app/…): JSON in, JSON out; the member's session as a bearer token. */
export async function siteApi<T>(path: string, body: unknown, withSession = false): Promise<T & { error?: string; field?: { name: string; error: string } | null }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (withSession) {
    const { data } = await supabase().auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  try {
    const res = await fetch(`${SITE_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    return (await res.json()) as T & { error?: string };
  } catch {
    return { error: "network" } as T & { error?: string };
  }
}
