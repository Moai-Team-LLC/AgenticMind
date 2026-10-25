/** HITL notification subsystem: the payload-free channel contract + pure formatters + Telegram sender. */
export { type AssuranceNotification, type AssuranceNotifier, consoleNotifier } from "./channel"
export { formatApprovalRequest, formatDriftAlert } from "./format"
export { makeTelegramNotifier, renderTelegramText, type TelegramConfig } from "./telegram"
