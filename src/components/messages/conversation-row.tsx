"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bell, BellOff, ChevronDown, Pencil, Pin, PinOff, Star, StarOff, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { updateConversationPref, type ConversationPrefChange } from "@/server/messages";

/** How long a press lasts before it opens the menu, and how far the finger may drift meanwhile. */
const HOLD_MS = 500;
const DRIFT_PX = 10;

type Step = "main" | "mute" | "nickname" | "delete";

/**
 * A conversation in the list. A long press (or a right click, or «⌄» on a
 * computer) opens its menu: pin, mute, favourite, a nickname, delete. All of it
 * is the member's own (migration 0040); the list refreshes after each change.
 *
 * The row itself stays a link: the press that opens the menu doesn't also open
 * the conversation, and on iPhones it shows no link preview.
 */
export function ConversationRow({
  conversationId,
  name,
  pinned,
  muted,
  favorite,
  nickname,
  children,
}: {
  conversationId: string;
  /** What the row shows as its name (the nickname when there is one). */
  name: string;
  pinned: boolean;
  muted: boolean;
  favorite: boolean;
  nickname: string | null;
  children: ReactNode;
}) {
  const t = useTranslations("messages");
  const errors = useTranslations("errors");
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [step, setStep] = useState<Step>("main");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(nickname ?? "");
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  // Set when a long press opened the menu: the click that ends the press must not open the conversation.
  const swallowClick = useRef(false);

  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  useEffect(() => cancelHold, []);

  const open = () => {
    setStep("main");
    setError(null);
    setDraft(nickname ?? "");
    if (!dialog.current?.open) dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();
  const inMenu = (target: EventTarget | null) => target instanceof Node && Boolean(dialog.current?.contains(target));

  const onPointerDown = (e: PointerEvent) => {
    swallowClick.current = false;
    if (e.button !== 0 || inMenu(e.target) || (e.target as Element).closest?.("[data-row-menu]")) return;
    cancelHold();
    hold.current = {
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        hold.current = null;
        swallowClick.current = true;
        navigator.vibrate?.(10);
        open();
      }, HOLD_MS),
    };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > DRIFT_PX) cancelHold();
  };
  // A right click on a computer; on Android a long press fires this too.
  const onContextMenu = (e: MouseEvent) => {
    if (inMenu(e.target)) return;
    e.preventDefault();
    cancelHold();
    open();
  };
  const onClickCapture = (e: MouseEvent) => {
    if (swallowClick.current && !inMenu(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
    swallowClick.current = false;
  };

  const run = async (change: ConversationPrefChange) => {
    setBusy(true);
    setError(null);
    const res = await updateConversationPref(conversationId, change);
    setBusy(false);
    if (!res.ok) {
      setError(errors.has(res.error) ? errors(res.error) : errors("generic"));
      return;
    }
    close();
    router.refresh();
  };

  const item = "justify-start gap-3";
  return (
    <li
      className="group relative select-none border-b border-line last:border-b-0 [-webkit-touch-callout:none]"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={onContextMenu}
      onClickCapture={onClickCapture}
    >
      {children}
      {/* On a computer: the menu on hover or keyboard focus. Phones use the long press (screen readers still reach this). */}
      <button
        type="button"
        data-row-menu=""
        onClick={open}
        aria-label={t("rowMenu", { name })}
        aria-haspopup="dialog"
        className="absolute end-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface-2 text-muted opacity-0 shadow-sm transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:sr-only"
      >
        <ChevronDown aria-hidden="true" className="size-4" />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="m-auto w-[min(92vw,22rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl"
      >
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="min-w-0 truncate font-display text-lg font-semibold">
              {step === "mute" ? t("muteTitle") : step === "nickname" ? t("nicknameTitle") : step === "delete" ? t("deleteChatTitle") : name}
            </h2>
            <Button variant="ghost" size="sm" onClick={close} aria-label={t("cancel")}>
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

          {step === "main" ? (
            <div className="flex flex-col gap-2">
              <Button variant="outline" className={item} disabled={busy} onClick={() => run({ kind: "pin", value: !pinned })}>
                {pinned ? <PinOff aria-hidden="true" className="size-4" /> : <Pin aria-hidden="true" className="size-4" />}
                {pinned ? t("unpin") : t("pin")}
              </Button>
              {muted ? (
                <Button variant="outline" className={item} disabled={busy} onClick={() => run({ kind: "mute", hours: 0 })}>
                  <Bell aria-hidden="true" className="size-4" />
                  {t("unmute")}
                </Button>
              ) : (
                <Button variant="outline" className={item} onClick={() => setStep("mute")}>
                  <BellOff aria-hidden="true" className="size-4" />
                  {t("mute")}
                </Button>
              )}
              <Button variant="outline" className={item} disabled={busy} onClick={() => run({ kind: "favorite", value: !favorite })}>
                {favorite ? <StarOff aria-hidden="true" className="size-4" /> : <Star aria-hidden="true" className="size-4" />}
                {favorite ? t("unfavorite") : t("favorite")}
              </Button>
              <Button variant="outline" className={item} onClick={() => setStep("nickname")}>
                <Pencil aria-hidden="true" className="size-4" />
                {nickname ? t("editNickname") : t("addNickname")}
              </Button>
              <Button variant="outline" className={`${item} text-danger`} onClick={() => setStep("delete")}>
                <Trash2 aria-hidden="true" className="size-4" />
                {t("deleteChat")}
              </Button>
            </div>
          ) : null}

          {step === "mute" ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">{t("muteBody")}</p>
              {([
                [8, t("mute8h")],
                [168, t("muteWeek")],
                [-1, t("muteAlways")],
              ] as const).map(([hours, label]) => (
                <Button key={hours} variant="outline" className={item} disabled={busy} onClick={() => run({ kind: "mute", hours })}>
                  {label}
                </Button>
              ))}
              <BackButton onClick={() => setStep("main")} label={t("back")} />
            </div>
          ) : null}

          {step === "nickname" ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run({ kind: "nickname", value: draft });
              }}
            >
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {t("nicknameLabel")}
                <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={40} autoFocus dir="auto" />
              </label>
              <p className="text-xs text-muted">{t("nicknameHint")}</p>
              <div className="flex flex-wrap justify-end gap-2">
                <BackButton onClick={() => setStep("main")} label={t("back")} />
                {nickname ? (
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => run({ kind: "nickname", value: "" })}>
                    {t("removeNickname")}
                  </Button>
                ) : null}
                <Button type="submit" disabled={busy || !draft.trim()}>{t("save")}</Button>
              </div>
            </form>
          ) : null}

          {step === "delete" ? (
            <>
              <p className="text-sm text-muted">{t("deleteChatBody")}</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setStep("main")}>{t("cancel")}</Button>
                <Button variant="danger" disabled={busy} onClick={() => run({ kind: "clear" })}>{t("deleteChat")}</Button>
              </div>
            </>
          ) : null}
        </div>
      </dialog>
    </li>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" variant="ghost" onClick={onClick}>
      {/* The page is right to left: back points right. */}
      <ArrowRight aria-hidden="true" className="size-4 ltr:-scale-x-100" />
      {label}
    </Button>
  );
}
