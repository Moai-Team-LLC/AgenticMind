/**
 * HITL notification channel (FR-10.2 / FR-11.3). The assurance layer tells a human two things: a
 * drift alert (a control regressed) and an approval request (an L3 remediation is waiting). Both go
 * out as a payload-free `AssuranceNotification` through a pluggable `AssuranceNotifier`.
 *
 * The engine ships no notifier, so — like the judge and the live collector — the transport is a
 * seam: the in-repo default logs, and a deployment injects a Telegram/Slack sender. Notifications
 * are payload-free (control ids + statuses, never raw evidence or secrets), so hash-not-text holds
 * even off-box.
 */
export interface AssuranceNotification {
  kind: "drift" | "approval-request"
  severity: "critical" | "warning" | "info"
  title: string
  /** Short, human-readable, payload-free body — ids and statuses only. */
  body: string
  /** Structural context a rich channel can render (ids/counts only, never payloads). */
  context: Record<string, string | number>
}

/** Pluggable delivery channel. In-repo default logs; a deployment injects Telegram/Slack. */
export type AssuranceNotifier = (notification: AssuranceNotification) => Promise<void>

/**
 * The safe default: log at the right level. Never throws — a notifier failure must not fail the
 * sweep or the remediation that emitted it (the run is already recorded by then).
 */
export const consoleNotifier: AssuranceNotifier = (notification) => {
  const log =
    notification.severity === "critical"
      ? console.error
      : notification.severity === "warning"
        ? console.warn
        : console.log
  log(
    `[ASSURANCE_NOTIFY] ${notification.kind}/${notification.severity}: ${notification.title} — ${notification.body}`,
    notification.context,
  )
  return Promise.resolve()
}
