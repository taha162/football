import { existsSync } from "node:fs";
import type { ExpoConfig } from "expo/config";

/**
 * «الملعب» as a native app (README.md). The same id as the store listing
 * (com.almalab.app). The site's address is the only setting: the database's
 * public address and key come from the site when the app opens
 * (/api/app/config), so a change there needs no new app in the stores.
 * - APP_SITE_URL: another site (a preview) for a test build.
 * - google-services.json (Firebase, Android notifications): added by the build
 *   when saved as a secret; without it the app works without notifications.
 */
const googleServices = existsSync("./google-services.json");

const config: ExpoConfig = {
  name: "الملعب",
  slug: "al-malab",
  scheme: "almalab",
  version: process.env.APP_VERSION_NAME || "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: "#0a0e0b",
  ios: {
    bundleIdentifier: process.env.APP_ID || "com.almalab.app",
    // Each upload to the stores needs a higher number (the build's run number on GitHub).
    buildNumber: process.env.APP_VERSION_CODE || "1",
    supportsTablet: false,
    infoPlist: {
      CFBundleDevelopmentRegion: "ar",
      NSCameraUsageDescription: "لالتقاط صورة ترسلها في المحادثة، أو لصورتك الشخصية.",
      NSPhotoLibraryUsageDescription: "لاختيار صورة من هاتفك لإرسالها أو لصورتك الشخصية.",
      NSMicrophoneUsageDescription: "للرسائل الصوتية والمكالمات مع اللاعبين.",
      NSLocationWhenInUseUsageDescription: "لإرسال موقعك في المحادثة حين تختار ذلك.",
      ITSAppUsesNonExemptEncryption: false,
    },
    entitlements: { "aps-environment": "production" },
  },
  android: {
    package: process.env.APP_ID || "com.almalab.app",
    versionCode: Number(process.env.APP_VERSION_CODE || 1),
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-foreground.png",
      backgroundImage: "./assets/adaptive-background.png",
      backgroundColor: "#baff1b",
    },
    allowBackup: false,
    permissions: ["POST_NOTIFICATIONS"],
    // Added by default but never used: Google Play asks to justify each one.
    blockedPermissions: ["android.permission.SYSTEM_ALERT_WINDOW", "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE"],
    ...(googleServices ? { googleServicesFile: "./google-services.json" } : {}),
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    ["expo-splash-screen", { image: "./assets/splash-icon.png", imageWidth: 160, backgroundColor: "#0a0e0b" }],
    "expo-image",
    "expo-web-browser",
    "expo-localization",
    ["expo-notifications", { color: "#baff1b" }],
  ],
  experiments: { typedRoutes: false },
  extra: {
    siteUrl: (process.env.APP_SITE_URL || "https://al-malab.vercel.app").replace(/\/+$/, ""),
    // Arabic only: the layout is right to left on every phone.
    supportsRTL: true,
    forcesRTL: true,
    // Notifications on Android need google-services.json in the build.
    androidPush: googleServices,
  },
};

export default config;
