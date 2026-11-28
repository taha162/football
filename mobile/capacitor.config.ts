import { existsSync } from "node:fs";
import type { CapacitorConfig } from "@capacitor/cli";

/**
 * «الملعب» for Google Play and the App Store.
 *
 * The site is rendered by its server (Next.js on Vercel), so the app shows the
 * live site in a native WebView rather than a copy bundled into the app: every
 * update to the site reaches the app at once, with no new store release.
 * - APP_SITE_URL: the site's address (production by default). A preview build
 *   can point at another one: APP_SITE_URL=https://… npx cap sync
 * - The user agent says "AlMalabApp": the site then lays itself out for the
 *   app (edge to edge, room for the status bar and the notch). It only changes
 *   the layout; nothing about who may do what depends on it.
 * - "Push" is added when the app can receive notifications: always on iPhone;
 *   on Android only when built with Firebase's google-services.json, without
 *   which registering would crash the app. The site asks only then.
 * - No connection: www/offline.html, with a button that tries again.
 * - Other sites (WhatsApp, maps, Supabase e-mail links…) open outside the app.
 */
// Capacitor reads this file from mobile/ (npm run sync), so paths are relative to it.
const site = (process.env.APP_SITE_URL || "https://al-malab.vercel.app").replace(/\/+$/, "");

const config: CapacitorConfig = {
  // Permanent once the app is published: the stores identify it by this.
  appId: process.env.APP_ID || "com.almalab.app",
  appName: "الملعب",
  webDir: "www",
  backgroundColor: "#0a0e0b",
  appendUserAgent: "AlMalabApp/1",
  server: {
    url: `${site}/ar/dashboard`,
    errorPath: "offline.html",
  },
  ios: {
    appendUserAgent: "AlMalabApp/1 Push",
    // The site keeps clear of the notch and the home bar itself (viewport-fit=cover in app mode).
    contentInset: "never",
    scrollEnabled: true,
  },
  android: {
    allowMixedContent: false,
    appendUserAgent: existsSync("android/app/google-services.json") ? "AlMalabApp/1 Push" : "AlMalabApp/1",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      launchFadeOutDuration: 250,
      backgroundColor: "#0a0e0b",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: false,
      splashImmersive: false,
    },
    SystemBars: {
      // Light icons on the dark site; safe areas reach the page as env() and --safe-area-inset-*.
      style: "DARK",
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
