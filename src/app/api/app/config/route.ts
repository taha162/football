import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The phone app (native/) asks here on opening where the database is, so a
 * change of project needs no new app in the stores. Public values only: the
 * site's pages carry them too.
 */
export function GET() {
  return NextResponse.json(
    { supabaseUrl: publicEnv.supabaseUrl, supabaseAnonKey: publicEnv.supabaseAnonKey, siteUrl: publicEnv.siteUrl },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
