import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button";
import { Container } from "@/components/ui/primitives";

export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <Container className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="font-display text-7xl font-extrabold text-accent">404</p>
      <h1 className="font-display text-2xl font-bold">{t("title")}</h1>
      <p className="max-w-md text-muted">{t("body")}</p>
      <Link href="/" className={buttonClass("primary", "md")}>{t("home")}</Link>
    </Container>
  );
}
