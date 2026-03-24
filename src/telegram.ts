const TELEGRAM_API = "https://api.telegram.org";

/** Telegram max message length */
const CHUNK = 4000;

/**
 * Send one or more Telegram messages (chunks long text).
 * @returns false if send failed (logs to console)
 */
export async function sendTelegramMessages(
  botToken: string,
  chatId: string,
  text: string
): Promise<boolean> {
  if (!botToken || !chatId) {
    console.warn("[Telegram] missing bot token or chat id");
    return false;
  }
  const payload = text.trim() || "KalshiMadness — scan complete (no summary text).";

  const chatIdTrim = chatId.trim();
  const chatIdJson: string | number = /^-?\d+$/.test(chatIdTrim)
    ? parseInt(chatIdTrim, 10)
    : chatIdTrim;

  const chunks: string[] = [];
  const lines = payload.split("\n");
  let buf = "";
  for (const line of lines) {
    const next = buf ? `${buf}\n${line}` : line;
    if (next.length > CHUNK) {
      if (buf) chunks.push(buf);
      buf = line.length > CHUNK ? line.slice(0, CHUNK) : line;
      while (buf.length >= CHUNK) {
        chunks.push(buf.slice(0, CHUNK));
        buf = buf.slice(CHUNK);
      }
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(buf);

  let ok = true;
  for (const body of chunks) {
    const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatIdJson,
          text: body,
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        let detail = errText;
        try {
          const j = JSON.parse(errText) as { description?: string };
          if (j.description) detail = j.description;
        } catch {
          /* keep raw */
        }
        console.error("[Telegram] sendMessage failed:", res.status, detail);
        ok = false;
      }
    } catch (e) {
      console.error("[Telegram] request failed:", e);
      ok = false;
    }
  }
  return ok;
}
