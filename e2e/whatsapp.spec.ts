import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { admin, createAuthUser, expect, localTime, mosul, PASSWORD, rpc, signIn, test, whatsappMessage, type TestUser } from "./fixtures";

/**
 * WhatsApp through the platform's own number (whatsapp-bot/), without
 * WhatsApp itself: these tests play the bot. They post incoming messages to
 * the site's webhook as the bot does, and answer the site's calls to the bot
 * (WHATSAPP_BOT_URL) with a small stand-in that "sends" each message at once.
 * One worker runs them in order, since the stand-in owns one port.
 */
test.describe.configure({ mode: "serial" });

const phone = () => `9647${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const localFormat = (e164: string) => `0${e164.slice(3)}`;
const BOT_NUMBER = process.env.WHATSAPP_BOT_NUMBER ?? "";
const SECRET = process.env.WHATSAPP_BOT_SECRET ?? "";

/** The site's side of the bot: /send, /status, /cancel, /health and /link. */
class StandInBot {
  received: { id: string; to: string; text: string; kind: string }[] = [];
  private server: Server | null = null;

  async start() {
    const port = Number(new URL(process.env.WHATSAPP_BOT_URL ?? "http://localhost:4599").port);
    this.server = createServer(async (req, res) => {
      const body = await readJson(req);
      const reply = (status: number, json: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (req.headers.authorization !== `Bearer ${SECRET}`) return reply(401, { error: "unauthorized" });
      if (req.url === "/send") {
        this.received.push(body as StandInBot["received"][number]);
        return reply(202, { id: body.id, state: "queued", position: 1 });
      }
      if (req.url === "/status") {
        const sent = new Set(this.received.map((m) => m.id));
        const results = Object.fromEntries((body.ids as string[]).map((id) => [id, sent.has(id) ? { state: "sent", at: new Date().toISOString() } : { state: "unknown" }]));
        return reply(200, { results });
      }
      if (req.url === "/cancel") return reply(200, { cancelled: [] });
      if (req.url === "/health") {
        return reply(200, {
          connection: "open", linked: true, number: BOT_NUMBER, paused: null,
          queue: { total: 0, replies: 0, booking: 0, promo: 0 }, sent: { lastHour: 0, today: this.received.length }, caps: { perHour: 30, perDay: 200 },
        });
      }
      if (req.url === "/link") return reply(200, { state: "linked" });
      return reply(404, { error: "not_found" });
    });
    await new Promise<void>((resolve) => this.server!.listen(port, resolve));
  }

  async stop() {
    await new Promise((resolve) => this.server?.close(resolve));
  }

  to(number: string) {
    return this.received.filter((m) => m.to === number);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

const bot = new StandInBot();
test.beforeAll(async () => bot.start());
test.afterAll(async () => bot.stop());

const setSetting = (key: string, value: unknown) =>
  admin("update public.platform_settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);

/** The scheduled job, as GitHub Actions calls it. */
async function runCron(baseURL: string) {
  const res = await fetch(`${baseURL}/api/cron`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(res.status).toBe(200);
}

/** A player whose number was verified (database fixture: what a verification leaves behind). */
async function playerWithPhone(name: string, cityId?: string): Promise<TestUser & { phone: string }> {
  const user = await createAuthUser(name);
  const number = phone();
  await admin("insert into private.user_phones (user_id, phone) values ($1, $2)", [user.id, number]);
  if (cityId) await admin("update public.profiles set city_id = $2 where id = $1", [user.id, cityId]);
  return { ...user, phone: number };
}

test.describe("WhatsApp verification", () => {
  test("sign up by sending the code from one's own WhatsApp, then sign in, recover the password, and stop messages", async ({ page, baseURL }) => {
    const from = phone();
    await page.goto("/ar/sign-up");
    // Every way that is set up is offered.
    await expect(page.getByRole("link", { name: "البريد", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "تيليغرام", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "واتساب", exact: true }).click();
    await page.waitForURL(/method=whatsapp/);
    await page.getByRole("textbox", { name: "الاسم الظاهر" }).fill("WhatsApp Player");
    await page.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
    await page.getByRole("checkbox", { name: /شروط الاستخدام/ }).check();
    // Offers only with a tick, and the box starts unticked.
    const promos = page.getByRole("checkbox", { name: "أرسلوا لي العروض على واتساب" });
    await expect(promos).not.toBeChecked();
    await promos.check();
    await page.getByRole("button", { name: "متابعة عبر واتساب" }).click();
    await page.waitForURL(/\/ar\/verify-whatsapp/);

    const code = (await page.getByTestId("verify-code").textContent())!.trim();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    await expect(page.getByRole("link", { name: "افتح واتساب" })).toHaveAttribute("data-href", `https://wa.me/${BOT_NUMBER}?text=${code}`);

    // Requests without the bot's secret are refused, and the body is checked.
    expect((await whatsappMessage(baseURL!, from, code, "wrong")).status).toBe(401);
    expect((await whatsappMessage(baseURL!, "not-a-number", code)).status).toBe(400);

    // The bot forwards the message with the sender's number: verified, and the page carries on by itself.
    const verified = await whatsappMessage(baseURL!, from, `رمزي ${code}`);
    expect(verified).toMatchObject({ status: 200 });
    expect(verified.reply).toContain("تم تأكيد رقمك");
    expect((await whatsappMessage(baseURL!, from, code)).reply).toContain("تم تأكيد رقمك"); // delivered twice: the same answer
    await page.waitForURL(/\/ar\/onboarding/, { timeout: 15_000 });
    await page.getByRole("combobox", { name: "المدينة" }).selectOption({ label: "البصرة" });
    await page.getByText("حارس مرمى", { exact: true }).click();
    await page.getByText("متوسط", { exact: true }).click();
    await page.getByRole("button", { name: "ابدأ اللعب" }).click();
    await page.waitForURL(/\/ar\/dashboard/);

    // Settings: the number, booking messages on, offers on (ticked at sign-up).
    await page.goto("/ar/settings");
    await expect(page.getByText(`+${from}`)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /رسائل حجوزاتي/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "العروض والأخبار" })).toBeChecked();

    // Sign in with the local number format.
    await page.context().clearCookies();
    await page.goto("/ar/sign-in");
    await page.getByRole("textbox", { name: "البريد الإلكتروني أو رقم الهاتف" }).fill(localFormat(from));
    await page.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await page.waitForURL(/\/ar\/dashboard/);

    // Forgot password → recover with WhatsApp, from the same number.
    await page.context().clearCookies();
    await page.goto("/ar/forgot-password");
    await page.getByRole("button", { name: "استعادة عبر واتساب" }).click();
    await page.waitForURL(/\/ar\/verify-whatsapp/);
    const resetCode = (await page.getByTestId("verify-code").textContent())!.trim();
    expect((await whatsappMessage(baseURL!, from, resetCode)).reply).toContain("لاختيار كلمة مرور جديدة");
    await page.waitForURL(/\/ar\/reset-password/, { timeout: 15_000 });
    await page.getByRole("textbox", { name: "كلمة المرور الجديدة" }).fill("N3w-pass-4567");
    await page.getByRole("textbox", { name: "تأكيد كلمة المرور" }).fill("N3w-pass-4567");
    await page.getByRole("button", { name: "حفظ كلمة المرور" }).click();
    await page.waitForURL(/\/ar\/dashboard/);

    // "0" stops everything, at once.
    const stopped = await whatsappMessage(baseURL!, from, "0");
    expect(stopped.reply).toContain("لن تصلك أي رسالة");
    await page.goto("/ar/settings");
    await expect(page.getByRole("checkbox", { name: /رسائل حجوزاتي/ })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "العروض والأخبار" })).not.toBeChecked();
  });

  test("a number that already has an account can't make another; a stranger's message gets help", async ({ page, browser, baseURL }) => {
    const from = phone();
    const signUp = async (p: typeof page) => {
      await p.goto("/ar/sign-up?method=whatsapp");
      await p.getByRole("textbox", { name: "الاسم الظاهر" }).fill("مرتين");
      await p.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
      await p.getByRole("checkbox", { name: /شروط الاستخدام/ }).check();
      await p.getByRole("button", { name: "متابعة عبر واتساب" }).click();
      await p.waitForURL(/\/ar\/verify-whatsapp/);
      return (await p.getByTestId("verify-code").textContent())!.trim();
    };
    await whatsappMessage(baseURL!, from, await signUp(page));
    await page.waitForURL(/\/ar\/onboarding/, { timeout: 15_000 });

    const other = await (await browser.newContext()).newPage();
    expect((await whatsappMessage(baseURL!, from, await signUp(other))).reply).toContain("مرتبط بحساب آخر");
    await expect(other.getByText("هذا الرقم مرتبط بحساب آخر في «الملعب».")).toBeVisible({ timeout: 15_000 });

    expect((await whatsappMessage(baseURL!, phone(), "ZZZZ-ZZZZ")).reply).toContain("غير صالح أو انتهت صلاحيته");
    expect((await whatsappMessage(baseURL!, phone(), "مرحبا")).reply).toContain("ابدأ من الموقع");
  });
});

/** A verified venue taking platform bookings, with a 5,000 IQD deposit. */
async function bookableVenue(owner: TestUser) {
  const venue = await rpc<string>(owner.id, "create_venue", { p_name: `E2E WhatsApp ${randomUUID().slice(0, 6)}`, p_city_id: await mosul() });
  const field = await rpc<string>(owner.id, "upsert_venue_field", {
    p_venue_id: venue, p_field_id: null, p_name: "Field 1", p_surface: "artificial_turf", p_formats: "{5v5}",
    p_is_covered: false, p_has_lights: true, p_price_per_hour: 30_000,
  });
  await rpc(owner.id, "set_venue_opening_hours", { p_venue_id: venue, p_hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "08:00", closes: "02:00" })) });
  await admin("update public.venues set verification_status = 'verified' where id = $1", [venue]);
  const [v] = await admin<{ name: string; city_id: string }>("select name, city_id from public.venues where id = $1", [venue]);
  await rpc(owner.id, "update_venue", { p_venue_id: venue, p_name: v.name, p_city_id: v.city_id, p_booking_mode: "platform", p_min_notice_minutes: 0 });
  await rpc(owner.id, "set_venue_deposit_instructions", { p_venue_id: venue, p_instructions: "Cash at the desk" });
  return { venue, field, name: v.name };
}

test.describe("WhatsApp booking messages", () => {
  test.beforeAll(() => setSetting("whatsapp.booking_messages", true));
  test.afterAll(() => setSetting("whatsapp.booking_messages", false));

  test("confirming a booking sends the player one message with the venue, the time and a link; the report comes back", async ({ browser, baseURL }) => {
    const owner = await createAuthUser("Owner");
    const player = await playerWithPhone("Player");
    const { venue, field, name } = await bookableVenue(owner);
    const { booking_id } = await rpc<{ booking_id: string }>(player.id, "request_booking", { p_field_id: field, p_start_local: localTime(2, 18), p_duration_minutes: 60 });
    await rpc(player.id, "report_booking_deposit", { p_booking_id: booking_id, p_reference: "WA-E2E" });

    const ctx = await browser.newContext();
    const ownerPage = await ctx.newPage();
    await signIn(ownerPage, owner);
    await ownerPage.goto(`/ar/manage/venues/${venue}?tab=bookings`);
    await ownerPage.getByRole("listitem").filter({ hasText: "WA-E2E" }).getByRole("button", { name: "استلمت العربون" }).click();
    await expect(ownerPage.getByText("لا توجد طلبات معلقة.")).toBeVisible();

    // Handed to the bot right after the response, not at the next scheduled run.
    await expect.poll(() => bot.to(player.phone).length, { timeout: 15_000 }).toBe(1);
    const [msg] = bot.to(player.phone);
    expect(msg.kind).toBe("booking");
    expect(msg.text).toContain(`✅ تأكّد حجزك في «${name}»`);
    expect(msg.text).toContain("بتوقيت العراق");
    expect(msg.text).toContain("عربون");
    expect(msg.text).toContain(`/ar/my/bookings#booking-${booking_id}`);

    // The next run asks the bot how it went, and records it.
    await runCron(baseURL!);
    const [row] = await admin<{ status: string; body: string }>("select status, body from public.outbound_messages where booking_id = $1", [booking_id]);
    expect(row).toMatchObject({ status: "sent", body: msg.text });
    // The link lands on the booking in My bookings.
    const playerCtx = await browser.newContext();
    const playerPage = await playerCtx.newPage();
    await signIn(playerPage, player);
    await playerPage.goto(`/ar/my/bookings#booking-${booking_id}`);
    await expect(playerPage.locator(`#booking-${booking_id}`)).toContainText(name);
    await ctx.close();
    await playerCtx.close();
  });
});

test.describe("WhatsApp promotions", () => {
  const SETTINGS = ["whatsapp.promo_daily_start", "whatsapp.promo_daily_step", "whatsapp.promo_daily_max"] as const;
  let saved: { key: string; value: unknown }[] = [];
  test.beforeAll(async () => {
    saved = await admin<{ key: string; value: unknown }>("select key, value from public.platform_settings where key = any($1)", [SETTINGS]);
    await admin("update public.whatsapp_campaigns set status = 'stopped', stopped_at = now() where status = 'sending'");
  });
  test.afterAll(async () => {
    for (const s of saved) await setSetting(s.key, s.value);
  });

  /** Today's allowance for promotions, whatever other runs handed out today. */
  async function allowance(n: number) {
    const [{ handed }] = await admin<{ handed: number }>(
      "select count(*)::int as handed from public.outbound_messages where kind = 'promo' and first_handed_at >= ((now() at time zone 'Asia/Baghdad')::date)::timestamp at time zone 'Asia/Baghdad'",
    );
    await setSetting("whatsapp.promo_daily_start", handed + n);
    await setSetting("whatsapp.promo_daily_step", 0);
    await setSetting("whatsapp.promo_daily_max", 1_000_000);
  }

  test("an admin writes an offer, sees it as it arrives, confirms the count, sends it only to people who opted in, and can stop it", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const city = (await admin<{ id: string }>(
      "insert into public.cities (slug, name_en, name_ar, country_code, timezone, currency, is_active) values ($1, 'WA E2E', $2, 'IQ', 'Asia/Baghdad', 'IQD', false) returning id",
      [`wa-e2e-${randomUUID().slice(0, 8)}`, `مدينة اختبار ${randomUUID().slice(0, 4)}`],
    ))[0].id;
    const [{ name_ar: cityName }] = await admin<{ name_ar: string }>("select name_ar from public.cities where id = $1", [city]);
    const fans = [await playerWithPhone("Fan", city), await playerWithPhone("Fan", city)];
    for (const f of fans) await rpc(f.id, "set_my_whatsapp_settings", { p_bookings: true, p_promos: true });
    const quiet = await playerWithPhone("Quiet", city); // never ticked the box
    const boss = await createAuthUser("Boss", { admin: true });
    await signIn(page, boss);

    // First campaign: nothing may go out today, so it all waits, and it is stopped.
    await allowance(0);
    await page.goto("/ar/admin/promotions");
    await page.getByRole("textbox", { name: "نص الرسالة" }).fill("عرض الأسبوع: ساعة مجانية لكل خمس حجوزات.");
    await expect(page.getByTestId("promo-preview")).toContainText(boss.name.split(" ")[0]);
    await expect(page.getByTestId("promo-preview")).toContainText("لإيقاف هذه الرسائل أرسل 0");
    await page.getByRole("combobox", { name: "إلى" }).selectOption({ label: `${cityName} (٢)` });
    await page.getByRole("button", { name: "إرسال", exact: true }).click();
    await expect(page.getByTestId("promo-recipients")).toHaveText("عدد المستلمين: ٢");
    await page.getByRole("button", { name: "أرسل الآن" }).click();
    await expect(page.getByText("بدأ الإرسال", { exact: false })).toBeVisible();
    await page.reload();
    const first = page.getByTestId("campaign-row").first();
    await expect(first).toContainText("جارٍ الإرسال");
    await expect(first).toContainText("المستلمون: ٢");
    await first.getByRole("button", { name: "إيقاف الحملة" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "إيقاف الحملة" }).click();
    await expect(page.getByTestId("campaign-row").first()).toContainText("أُوقفت");
    expect(bot.received.filter((m) => m.kind === "promo" && fans.some((f) => f.phone === m.to))).toHaveLength(0);

    // Second campaign: sent, only to the two who opted in, each greeted by name.
    await allowance(10);
    await page.getByRole("textbox", { name: "نص الرسالة" }).fill("ملعب جديد في مدينتك!");
    await page.getByRole("combobox", { name: "إلى" }).selectOption({ label: `${cityName} (٢)` });
    await page.getByRole("button", { name: "إرسال", exact: true }).click();
    await page.getByRole("button", { name: "أرسل الآن" }).click();
    await expect(page.getByText("بدأ الإرسال", { exact: false })).toBeVisible();
    await expect.poll(() => fans.map((f) => bot.to(f.phone).length), { timeout: 15_000 }).toEqual([1, 1]);
    expect(bot.to(quiet.phone)).toHaveLength(0);
    for (const f of fans) {
      const [m] = bot.to(f.phone);
      expect(m.kind).toBe("promo");
      expect(m.text).toContain("ملعب جديد في مدينتك!");
      expect(m.text.split("\n")[0]).toContain("Fan");
      expect(m.text.trim().split("\n").at(-1)).toBe("لإيقاف هذه الرسائل أرسل 0");
    }
    await runCron(baseURL!);
    await page.reload();
    const second = page.getByTestId("campaign-row").first();
    await expect(second).toContainText("انتهت");
    await expect(second).toContainText("أُرسل ٢");

    // Every campaign is in the audit log, with who did it.
    const audit = await admin<{ action: string; actor_id: string }>(
      "select action, actor_id from public.audit_logs where entity_type = 'whatsapp_campaign' and actor_id = $1 order by id",
      [boss.id],
    );
    expect(audit.map((a) => a.action)).toEqual(["whatsapp_campaign_started", "whatsapp_campaign_stopped", "whatsapp_campaign_started"]);
  });

  test("moderators and players can't open the promotions page", async ({ page }) => {
    const player = await createAuthUser("Player");
    await signIn(page, player);
    await page.goto("/ar/admin/promotions");
    await expect(page).not.toHaveURL(/\/admin\/promotions/);
  });
});
