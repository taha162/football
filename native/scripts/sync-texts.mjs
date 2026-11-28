// The site's Arabic texts the app shows as they are (errors, field messages, match statuses, booking), copied from
// messages/ar.json so both say the same thing. Run after changing them: npm run texts
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const site = JSON.parse(readFileSync(fileURLToPath(new URL("../../messages/ar.json", import.meta.url)), "utf8"));
const out = { errors: site.errors, validation: site.validation, matchStatus: site.match.status, booking: site.booking, bookings: site.bookings, enums: site.enums, legal: site.legal };
writeFileSync(fileURLToPath(new URL("../src/lib/site-texts.json", import.meta.url)), `${JSON.stringify(out, null, 2)}\n`);
console.log(`src/lib/site-texts.json: ${Object.keys(out.errors).length} errors, ${Object.keys(out.validation).length} field messages`);
