import { createServer, connect, type Http2Server } from "node:http2";
import type { AddressInfo } from "node:net";
import { createVerify, generateKeyPairSync, verify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { apnsConfig, sendApns } from "@/lib/push/apns";
import { fcmConfig, sendFcm } from "@/lib/push/fcm";

const message = { title: "سارة", body: "أهلاً", href: "/messages/abc", tag: "c:abc" };
const part = (jwt: string, i: number) => JSON.parse(Buffer.from(jwt.split(".")[i], "base64url").toString("utf8"));

describe("Android (Firebase HTTP v1)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const account = {
    project_id: "al-malab-test",
    client_email: "push@al-malab-test.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads the service account as JSON or base64, and nothing else", () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT", JSON.stringify(account));
    expect(fcmConfig()?.project_id).toBe("al-malab-test");
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT", Buffer.from(JSON.stringify(account)).toString("base64"));
    expect(fcmConfig()?.client_email).toBe(account.client_email);
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT", "{not json");
    expect(fcmConfig()).toBeNull();
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT", "");
    expect(fcmConfig()).toBeNull();
  });

  it("signs in with a token signed by the account's key, then sends the notification with where it opens", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }));
        return new Response(JSON.stringify({ name: "projects/x/messages/1" }));
      }),
    );
    expect(await sendFcm(account, "android-token", message)).toBe("sent");

    const assertion = new URLSearchParams(String(calls[0].init.body)).get("assertion")!;
    const [head, claims, signature] = assertion.split(".");
    expect(createVerify("RSA-SHA256").update(`${head}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
    expect(part(assertion, 1)).toMatchObject({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging" });

    expect(calls[1].url).toBe("https://fcm.googleapis.com/v1/projects/al-malab-test/messages:send");
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer ya29.test");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      message: {
        token: "android-token",
        notification: { title: "سارة", body: "أهلاً" },
        data: { href: "/messages/abc" },
        android: { priority: "HIGH", notification: { sound: "default", tag: "c:abc" } },
      },
    });
  });

  it("a phone that left the app is reported gone; other failures are just failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }), { status: 404 })));
    expect(await sendFcm(account, "old-token", message)).toBe("gone");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503 })));
    expect(await sendFcm(account, "token", message)).toBe("failed");
  });
});

describe("iPhone (APNs)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  let server: Http2Server | null = null;

  afterEach(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    server = null;
  });

  /** A stand-in for Apple's server: answers with `status`/`reason`, and keeps what it was sent. */
  async function apple(status: number, reason?: string) {
    const seen: { headers: Record<string, unknown>; body: string }[] = [];
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ headers: req.headers as Record<string, unknown>, body });
        res.writeHead(status);
        res.end(reason ? JSON.stringify({ reason }) : "");
      });
    });
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", () => done()));
    const session = connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    return { seen, session };
  }

  it("reads the key (text or base64) and its ids; the app's id defaults to com.almalab.app", () => {
    vi.stubEnv("APNS_KEY", pem);
    vi.stubEnv("APNS_KEY_ID", "KEY123");
    vi.stubEnv("APNS_TEAM_ID", "TEAM456");
    expect(apnsConfig()).toMatchObject({ keyId: "KEY123", teamId: "TEAM456", bundleId: "com.almalab.app", host: "https://api.push.apple.com" });
    vi.stubEnv("APNS_KEY", Buffer.from(pem).toString("base64"));
    vi.stubEnv("APNS_ENV", "sandbox");
    expect(apnsConfig()?.host).toBe("https://api.sandbox.push.apple.com");
    vi.stubEnv("APNS_KEY_ID", "");
    expect(apnsConfig()).toBeNull();
  });

  it("sends the alert with a token signed by the key, for this app, to this phone", async () => {
    vi.stubEnv("APNS_KEY", pem);
    vi.stubEnv("APNS_KEY_ID", "KEY123");
    vi.stubEnv("APNS_TEAM_ID", "TEAM456");
    const config = apnsConfig()!;
    const { seen, session } = await apple(200);
    const deviceToken = "a1".repeat(32);
    expect(await sendApns(config, session, deviceToken, message)).toBe("sent");
    session.close();

    const [{ headers, body }] = seen;
    expect(headers[":path"]).toBe(`/3/device/${deviceToken}`);
    expect(headers["apns-topic"]).toBe("com.almalab.app");
    expect(headers["apns-push-type"]).toBe("alert");
    expect(headers["apns-collapse-id"]).toBe("c:abc");
    const jwt = String(headers.authorization).replace(/^bearer /, "");
    expect(part(jwt, 0)).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(part(jwt, 1)).toMatchObject({ iss: "TEAM456" });
    const [h, c, s] = jwt.split(".");
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))).toBe(true);
    expect(JSON.parse(body)).toEqual({ aps: { alert: { title: "سارة", body: "أهلاً" }, sound: "default", "thread-id": "c:abc" }, href: "/messages/abc" });
  });

  it("a phone that left the app is reported gone; a malformed token isn't even sent", async () => {
    vi.stubEnv("APNS_KEY", pem);
    vi.stubEnv("APNS_KEY_ID", "KEY123");
    vi.stubEnv("APNS_TEAM_ID", "TEAM456");
    const config = apnsConfig()!;
    const { seen, session } = await apple(410, "Unregistered");
    expect(await sendApns(config, session, "b2".repeat(32), message)).toBe("gone");
    expect(await sendApns(config, session, "not-a-token/../x", message)).toBe("gone");
    session.close();
    expect(seen).toHaveLength(1);
  });
});
