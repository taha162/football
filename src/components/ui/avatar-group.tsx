import { cn } from "@/lib/cn";
import { Avatar } from "./avatar";

export interface GroupMember {
  id: string;
  name: string;
  src: string | null;
}

/**
 * Overlapping profile circles with a ring of the background between them,
 * and +N at the end for the rest: the first one sits on top, each next one
 * tucked under it, along the page's direction. One picture for screen readers,
 * named by `label` (who is in it).
 */
export function AvatarGroup({ people, total, label, size = 26, className }: { people: GroupMember[]; total: number; label: string; size?: number; className?: string }) {
  const more = Math.max(0, total - people.length);
  if (people.length === 0) return null;
  return (
    <div role="img" aria-label={label} className={cn("flex shrink-0 items-center", className)} data-testid="avatar-group">
      {people.map((p, i) => (
        <span key={p.id} title={p.name} className={cn("relative inline-flex rounded-full ring-2 ring-surface", i > 0 && "-ms-2")} style={{ zIndex: people.length - i + 1 }}>
          <Avatar src={p.src} name={p.name} size={size} />
        </span>
      ))}
      {more > 0 ? (
        <span
          className="num relative -ms-2 inline-flex items-center justify-center rounded-full bg-surface-3 font-semibold text-muted ring-2 ring-surface"
          style={{ width: size, height: size, fontSize: Math.max(10, size * 0.4), zIndex: 0 }}
        >
          +{more}
        </span>
      ) : null}
    </div>
  );
}
