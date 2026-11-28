// Writes www/, the few local pages the app carries (run by `npm run sync` before `cap sync`):
// - index.html: never shown in normal use (the app opens the site); it just goes there.
// - offline.html: shown when the site can't be reached. «إعادة المحاولة» opens the site again,
//   and it tries by itself when the phone is back online.
// The site's address comes from APP_SITE_URL, as in capacitor.config.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const site = (process.env.APP_SITE_URL || "https://al-malab.vercel.app").replace(/\/+$/, "");
const start = `${site}/ar/dashboard`;
const dir = fileURLToPath(new URL("../www/", import.meta.url));
mkdirSync(dir, { recursive: true });

const page = (title, body) => `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${title}</title>
<style>
  :root { --bg: #0a0e0b; --ink: #f2f5ef; --muted: #9aa494; --accent: #baff1b; --accent-ink: #0c0e0b; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; background: var(--bg); color: var(--ink); }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
    padding: calc(env(safe-area-inset-top) + 24px) 24px calc(env(safe-area-inset-bottom) + 24px);
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; text-align: center;
  }
  .mark { width: 88px; height: 88px; border-radius: 22px; background: var(--accent); display: grid; place-items: center; }
  .mark span { width: 60px; height: 60px; border-radius: 50%; background: var(--accent-ink); }
  h1 { margin: 6px 0 0; font-size: 22px; }
  p { margin: 0; max-width: 32ch; color: var(--muted); }
  button {
    margin-top: 6px; min-height: 48px; padding: 0 28px; border: 0; border-radius: 999px;
    background: var(--accent); color: var(--accent-ink); font: inherit; font-weight: 700;
  }
  button:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }
</style>
</head>
<body>
${body}
<script>
  var START = ${JSON.stringify(start)};
  function go() { location.replace(START); }
  var again = document.getElementById("again");
  if (again) again.addEventListener("click", go);
  window.addEventListener("online", go);
</script>
</body>
</html>
`;

writeFileSync(
  `${dir}index.html`,
  page("الملعب", `<div class="mark" aria-hidden="true"><span></span></div>\n<script>location.replace(${JSON.stringify(start)});</script>`),
);
writeFileSync(
  `${dir}offline.html`,
  page(
    "لا يوجد اتصال",
    `<div class="mark" aria-hidden="true"><span></span></div>
<h1>لا يوجد اتصال بالإنترنت</h1>
<p>تحقّق من الواي فاي أو بيانات الهاتف، ثم أعد المحاولة. يفتح «الملعب» وحده حين يعود الاتصال.</p>
<button id="again" type="button">إعادة المحاولة</button>`,
  ),
);
console.log(`www/: index.html and offline.html → ${start}`);
