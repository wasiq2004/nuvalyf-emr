import "server-only";

// Meta WhatsApp Cloud API (decision D9). Two drivers:
//   cloud - real HTTP calls to graph.facebook.com
//   log   - records the message as sent without calling anyone (development,
//           tests, and clinics still waiting for Meta business verification)
// WHATSAPP_DRIVER picks one; production defaults to cloud.
import { randomUUID } from "crypto";

const GRAPH = "https://graph.facebook.com/v21.0";

export type WhatsAppCredentials = { phoneNumberId: string; accessToken: string };
export type SendResult = { ok: true; providerMessageId: string } | { ok: false; error: string; permanent: boolean };

export function whatsappDriver(): "cloud" | "log" {
  const configured = process.env.WHATSAPP_DRIVER;
  if (configured === "cloud" || configured === "log") return configured;
  return process.env.NODE_ENV === "production" ? "cloud" : "log";
}

export async function sendTemplate(
  credentials: WhatsAppCredentials,
  message: { to: string; template: string; language: string; params: string[] },
): Promise<SendResult> {
  if (whatsappDriver() === "log") {
    console.info(`[whatsapp:log] to=${message.to.slice(0, 4)}…${message.to.slice(-2)} template=${message.template}`);
    return { ok: true, providerMessageId: `log-${randomUUID()}` };
  }
  try {
    const response = await fetch(`${GRAPH}/${encodeURIComponent(credentials.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: message.to,
        type: "template",
        template: {
          name: message.template,
          language: { code: message.language },
          components: message.params.length
            ? [{ type: "body", parameters: message.params.map((text) => ({ type: "text", text })) }]
            : [],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (response.ok && body.messages?.[0]?.id) return { ok: true, providerMessageId: body.messages[0].id };
    // 4xx (bad number, template not approved, token revoked) will not fix itself.
    return { ok: false, error: body.error?.message ?? `HTTP ${response.status}`, permanent: response.status >= 400 && response.status < 500 };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Network error", permanent: false };
  }
}

/** Checks the phone number ID and token work (no message is sent). */
export async function verifyConnection(credentials: WhatsAppCredentials): Promise<{ ok: boolean; detail: string }> {
  if (whatsappDriver() === "log") return { ok: true, detail: "Test mode: messages are recorded but not sent." };
  try {
    const response = await fetch(`${GRAPH}/${encodeURIComponent(credentials.phoneNumberId)}?fields=display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } };
    if (!response.ok) return { ok: false, detail: body.error?.message ?? `HTTP ${response.status}` };
    return { ok: true, detail: `${body.verified_name ?? "Connected"} · ${body.display_phone_number ?? ""}`.trim() };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "Network error" };
  }
}
