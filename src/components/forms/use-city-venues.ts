"use client";

import { useRef, useState, useTransition } from "react";
import type { VenueOption } from "@/components/match/match-form";
import { cityVenueOptionsAction } from "@/server/options-actions";

/**
 * The venues of the city a form has selected. The page renders the first
 * city's venues; choosing another city fetches that city's (only the latest
 * choice counts if several are in flight). Lists already fetched are kept, so
 * going back to a city is instant.
 */
export function useCityVenues(initialCity: string, initialVenues: VenueOption[]) {
  const [city, setCity] = useState(initialCity);
  const [venues, setVenues] = useState(initialVenues);
  const [pending, startTransition] = useTransition();
  const known = useRef(new Map<string, VenueOption[]>([[initialCity, initialVenues]]));
  const latest = useRef(initialCity);

  const chooseCity = (next: string) => {
    if (next === latest.current) return;
    latest.current = next;
    setCity(next);
    const cached = known.current.get(next) ?? (next ? undefined : []);
    if (cached) {
      setVenues(cached);
      return;
    }
    // Nothing from the previous city stays selectable while the new one loads.
    setVenues([]);
    startTransition(async () => {
      const list = await cityVenueOptionsAction(next);
      known.current.set(next, list);
      if (latest.current === next) setVenues(list);
    });
  };

  return { city, venues, pending, chooseCity };
}
