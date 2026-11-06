"use server";

import { uuid } from "@/lib/actions";
import type { VenueOption } from "@/components/match/match-form";
import { venueOptions } from "@/server/options";

/**
 * A city's venues for a form whose city has just changed. Read under the
 * person's own access rules (the same list the public venues page shows them).
 */
export async function cityVenueOptionsAction(cityId: string): Promise<VenueOption[]> {
  if (!uuid.safeParse(cityId).success) return [];
  return venueOptions(cityId);
}
