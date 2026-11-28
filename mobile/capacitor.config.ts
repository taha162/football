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
 * - No connection: www/offline.html, with a button that tries again.
 * - Other sites (WhatsApp, maps, Supabase e-mail links…) open outside the app.
 */
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
    // The site keeps clear of the notch and the home bar itself (viewport-fit=cover in app mode).
    contentInset: "never",
    scrollEnabled: true,
  },
  android: {
    allowMixedContent: false,
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
