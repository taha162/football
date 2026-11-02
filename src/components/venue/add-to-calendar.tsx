import { getTranslations } from "next-intl/server";
import { CalendarPlus } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

export interface CalendarLinks {
  /** The .ics file: the phone's own calendar (iPhone offers "Add to Calendar"). */
  ics: string;
  google: string;
}

/**
 * Adds a booking to a calendar. Plain links: the .ics answer itself tells the
 * phone it is a calendar event (no `download` attribute, which would send it
 * to Files on an iPhone instead).
 */
export async function AddToCalendar({ links, prominent = false }: { links: CalendarLinks; prominent?: boolean }) {
  const t = await getTranslations("bookings.calendar");
  if (prominent) {
    return (
      <div className="flex flex-wrap gap-2">
        <a href={links.ics} className={buttonClass("primary", "md")}>
          <CalendarPlus aria-hidden="true" className="size-4" />
          {t("phone")}
        </a>
        <a href={links.google} target="_blank" rel="noopener noreferrer" className={buttonClass("outline", "md")}>
          {t("google")}
        </a>
      </div>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
      <CalendarPlus aria-hidden="true" className="size-4 text-accent" />
      <span>{t("add")}:</span>
      <a href={links.ics} className="font-semibold text-accent underline-offset-2 hover:underline">{t("phone")}</a>
      <span aria-hidden="true">·</span>
      <a href={links.google} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline-offset-2 hover:underline">
        {t("google")}
      </a>
    </p>
  );
}
