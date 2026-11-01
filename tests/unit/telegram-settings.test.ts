import { describe, expect, it } from "vitest";
import { readBotSettings } from "@/lib/telegram-settings";

const TOKEN = "7123456789:AAHk3s9-Q_example_token_value_1234";

describe("readBotSettings", () => {
  it("accepts the values as BotFather gives them", () => {
    expect(readBotSettings(TOKEN, "AlMalabBot")).toEqual({ token: TOKEN, username: "AlMalabBot", problems: [] });
  });

  it("tolerates what copying on a phone brings along", () => {
    expect(readBotSettings(`  ${TOKEN}\n`, " @AlMalabBot ")).toMatchObject({ token: TOKEN, username: "AlMalabBot", problems: [] });
    expect(readBotSettings(TOKEN, "https://t.me/AlMalabBot").username).toBe("AlMalabBot");
    expect(readBotSettings(TOKEN, "t.me/AlMalabBot?start=x").username).toBe("AlMalabBot");
  });

  it("names each missing or malformed setting", () => {
    expect(readBotSettings(undefined, undefined).problems).toEqual(["token_missing", "username_missing"]);
    expect(readBotSettings("Use this token to access the HTTP API: " + TOKEN, "AlMalabBot").problems).toEqual(["token_invalid"]);
    expect(readBotSettings("12345", "AlMalabBot").problems).toEqual(["token_invalid"]);
    expect(readBotSettings(TOKEN, "الملعب").problems).toEqual(["username_invalid"]);
    expect(readBotSettings(TOKEN, "bot").problems).toEqual(["username_invalid"]);
  });
});
