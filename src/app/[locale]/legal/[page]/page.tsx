import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container, PageHeader } from "@/components/ui/primitives";

const PAGES = ["terms", "privacy", "safety"] as const;

export function generateStaticParams() {
  return PAGES.map((page) => ({ page }));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/legal/[page]">): Promise<Metadata> {
  const { locale, page } = await params;
  if (!PAGES.includes(page as (typeof PAGES)[number])) return {};
  const t = await getTranslations({ locale, namespace: `legal.${page}` });
  return { title: t("title") };
}

/**
 * Plain-language policy pages. These describe how the product actually
 * behaves; they are not a substitute for review by a qualified lawyer
 * before launch (see IMPLEMENTATION_STATUS.md).
 */
export default async function LegalPage({ params }: PageProps<"/[locale]/legal/[page]">) {
  const { locale, page } = await params;
  setRequestLocale(locale);
  if (!PAGES.includes(page as (typeof PAGES)[number])) notFound();
  const t = await getTranslations(`legal.${page as (typeof PAGES)[number]}`);
  const sections = t.raw("sections") as { heading: string; body: string }[];
  return (
    <Container className="max-w-3xl py-10">
      <PageHeader title={t("title")} description={t("intro")} />
      <div className="flex flex-col gap-6">
        {sections.map((s) => (
          <section key={s.heading} className="flex flex-col gap-2">
            <h2 className="font-display text-xl font-semibold">{s.heading}</h2>
            <p className="whitespace-pre-line text-muted">{s.body}</p>
          </section>
        ))}
      </div>
    </Container>
  );
}
