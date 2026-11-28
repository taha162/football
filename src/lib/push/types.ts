/** One notification for a phone (src/server/push.ts → fcm.ts / apns.ts). */
export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping it opens, inside the site (no locale): /messages/…, /friends… */
  href: string;
  /** Notifications with the same tag replace each other (one per conversation). */
  tag?: string;
}

/** What the push service said about the phone. "gone": it no longer exists or left the app; forget it. */
export type PushResult = "sent" | "gone" | "failed";

export const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");
