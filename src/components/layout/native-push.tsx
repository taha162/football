"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { registerPushDeviceAction } from "@/server/push-devices";

/**
 * Inside the phone app only (mobile/; the layout renders this for signed-in
 * members there): asks once for permission to notify, registers the phone
 * (migration 0051), and opens the page a tapped notification is about.
 * Capacitor's code is loaded here only, so browsers never download it.
 */
export function NativePush() {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    const listeners: { remove: () => Promise<void> }[] = [];
    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("PushNotifications")) return;
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const platform = Capacitor.getPlatform();
      listeners.push(
        await PushNotifications.addListener("registration", ({ value }) => {
          void registerPushDeviceAction(value, platform);
        }),
        await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
          const href = (notification.data as { href?: unknown } | undefined)?.href;
          // Only a page of this site.
          if (typeof href === "string" && href.startsWith("/") && !href.startsWith("//")) router.push(href);
        }),
      );
      let { receive } = await PushNotifications.checkPermissions();
      if (receive === "prompt" || receive === "prompt-with-rationale") ({ receive } = await PushNotifications.requestPermissions());
      if (receive === "granted" && !stopped) await PushNotifications.register();
    })().catch(() => undefined);
    return () => {
      stopped = true;
      for (const listener of listeners) void listener.remove();
    };
  }, [router]);
  return null;
}
