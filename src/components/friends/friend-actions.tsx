import { getTranslations } from "next-intl/server";
import { cancelFriendRequestAction, respondFriendRequestAction, sendFriendRequestAction } from "@/server/friends";
import { startDirectConversationAction } from "@/server/messages";
import { InlineAction } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/primitives";

export type FriendRelation = "self" | "friend" | "requested" | "incoming" | "blocked" | "none";

/**
 * What a member can do about another, by where they stand: add as a friend,
 * cancel a request, accept or decline one, or (friends) send a message.
 */
export async function FriendActions({
  userId,
  username,
  relation,
  withMessage = true,
}: {
  userId: string;
  username: string;
  relation: FriendRelation;
  /** «مراسلة» beside a friend (off where the page has its own). */
  withMessage?: boolean;
}) {
  const t = await getTranslations("friends");
  switch (relation) {
    case "none":
      return <InlineAction action={sendFriendRequestAction} values={{ username }} label={t("add")} variant="primary" />;
    case "requested":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{t("requestSent")}</Badge>
          <InlineAction action={cancelFriendRequestAction} values={{ user_id: userId }} label={t("cancelRequest")} variant="ghost" />
        </div>
      );
    case "incoming":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <InlineAction action={respondFriendRequestAction} values={{ user_id: userId, accept: "1" }} label={t("accept")} variant="primary" />
          <InlineAction action={respondFriendRequestAction} values={{ user_id: userId, accept: "0" }} label={t("decline")} variant="ghost" />
        </div>
      );
    case "friend":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="success">{t("isFriend")}</Badge>
          {withMessage ? <InlineAction action={startDirectConversationAction} values={{ user_id: userId }} label={t("message")} variant="secondary" /> : null}
        </div>
      );
    case "self":
      return <span className="text-sm text-muted">{t("isYou")}</span>;
    default:
      return <span className="text-sm text-muted">{t("cantAdd")}</span>;
  }
}
