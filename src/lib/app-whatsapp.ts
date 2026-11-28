import "server-only";
import { chatLink, whatsappConfig } from "@/lib/whatsapp";
import { verificationCode } from "@/server/signup-core";

/** What the app's waiting screen shows: the code to send, from which number's WhatsApp, and the chat that opens with it typed. */
export async function whatsappStep(ticket: string) {
  const code = (await verificationCode(ticket)) ?? "";
  const number = whatsappConfig().number;
  return { next: "whatsapp", ticket, code, botNumber: number, link: chatLink(number, code) };
}
