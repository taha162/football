import { Container } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <Container className="py-10" aria-busy="true">
      <div className="flex flex-col gap-4">
        <div className="h-9 w-64 animate-pulse rounded-lg bg-surface-2" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-[var(--radius-card)] bg-surface" />
          ))}
        </div>
      </div>
    </Container>
  );
}
