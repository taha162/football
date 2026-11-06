import type { Metadata } from "next";
import { MapPinned, Search } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Form from "next/form";
import { listVenues } from "@/server/venues/queries";
import { VenueCard } from "@/components/venue/venue-card";
import { buttonClass } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Container, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Pagination } from "@/components/ui/pagination";
import { LinkButton } from "@/components/ui/link-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/venues">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "venues" });
  return { title: t("title") };
}

const one = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : undefined);

export default async function VenuesPage({ params, searchParams }: PageProps<"/[locale]/venues">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("venues");
  // The search is by the venue's name only. `bookable=1` («+» in the bottom bar, "book a pitch" links) lists the
  // venues taking bookings, each opening its booking page.
  const q = one(sp.q);
  const bookable = one(sp.bookable) === "1";
  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);
  const { items, hasMore } = await listVenues({ q, bookable, page });
  const query: Record<string, string> = { ...(q ? { q } : {}), ...(bookable ? { bookable: "1" } : {}) };

  return (
    <Container className="py-10">
      <PageHeader
        title={bookable ? t("bookTitle") : t("title")}
        description={bookable ? t("bookDescription") : t("description")}
        actions={bookable ? undefined : <LinkButton href="/manage/venues/new" className={buttonClass("outline", "md")}>{t("listVenue")}</LinkButton>}
      />
      <Form action="" scroll={false} role="search" className="mb-6 flex gap-2">
        {bookable ? <input type="hidden" name="bookable" value="1" /> : null}
        <label htmlFor="venue-search" className="sr-only">{t("searchPlaceholder")}</label>
        <Input id="venue-search" type="search" name="q" defaultValue={q} placeholder={t("searchPlaceholder")} enterKeyHint="search" className="min-w-0 flex-1" />
        <button type="submit" className={buttonClass("primary", "md", "shrink-0")}>
          <Search aria-hidden="true" className="size-4" />
          {t("search")}
        </button>
      </Form>
      {items.length > 0 ? (
        <div className="flex flex-col gap-6">
          {/* Two venues a row on a phone, three on a wide screen. */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3" data-testid="venue-grid">
            {/* The first two rows on a phone (two cards each; a laptop shows three a row) are in the first screen. */}
            {items.map((v, i) => <VenueCard key={v.id} venue={v} eager={i < 4} href={bookable ? `/venues/${v.id}/book` : undefined} />)}
          </div>
          <Pagination pathname="/venues" query={query} page={page} hasMore={hasMore} />
        </div>
      ) : (
        <EmptyState icon={<MapPinned className="size-10" />} title={q ? t("emptySearch", { q }) : t("empty")}>
          {q ? t("emptySearchBody") : t("emptyBody")}
        </EmptyState>
      )}
    </Container>
  );
}
