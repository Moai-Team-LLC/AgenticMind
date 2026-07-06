/**
 * Telegram transport for the HITL notification channel — one concrete `AssuranceNotifier`. The
 * assurance layer defines the seam (`channel.ts`); this is a reference sender a deployment can inject
 * without the core depending on a vendor. Config is passed in (no global env read here, so it is
 * pure to construct and testable), and `fetchImpl` is injectable for tests.
 *
 * Plain text, no `parse_mode` — the message is already payload-free (ids/statuses only), and plain
 * text avoids Markdown-escaping pitfalls on control ids / arrows.
 */
import type { AssuranceNotification, AssuranceNotifier } from "./channel"

export interface TelegramConfig {
  botToken: string
  chatId: string
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

const ICON: Record<AssuranceNotification["severity"], string> = {
  critical: "🔴",
  warning: "🟡",
  info: "🔵",
}

/** Render a notification as the plain-text body of a Telegram message (payload-free). */
export function renderTelegramText(notification: AssuranceNotification): string {
  const context = Object.entries(notification.context)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ")
  return `${ICON[notification.severity]} ${notification.title}\n${notification.body}\n\n${context}`
}

/** Build a Telegram-backed notifier. Throws on a non-OK API response so the caller can react. */
export function makeTelegramNotifier(config: TelegramConfig): AssuranceNotifier {
  const send = config.fetchImpl ?? fetch
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`
  return async (notification) => {
    const response = await send(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, text: renderTelegramText(notification) }),
    })
    if (!response.ok) {
      throw new Error(`telegram sendMessage failed: ${response.status}`)
    }
  }
}
