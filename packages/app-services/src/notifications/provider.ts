import type { NotificationChannel } from "./types";

/**
 * Provider-neutral notification delivery abstraction — mirrors
 * `LocalDiscoveryProvider`/`OpenFinanceProvider`'s exact pattern. Receives
 * ONLY the rendered payload a delivery actually needs — never a full
 * financial snapshot, transaction history, or provider tokens (see
 * docs/ALERTS-NOTIFICATIONS.md, "Security / privacy"). No real external
 * provider (Firebase/APNs/SendGrid/Twilio) is implemented — see
 * `LIVE_EXTERNAL_NOTIFICATION_VALIDATION = NOT_CONFIGURED`.
 */
export interface NotificationPayload {
  readonly financialProfileId: string;
  readonly channel: NotificationChannel;
  readonly title: string;
  readonly body: string;
}

export interface NotificationSendResult {
  readonly delivered: boolean;
  readonly failureReasonCode?: string;
}

export interface NotificationProvider {
  readonly name: string;
  send(payload: NotificationPayload): Promise<NotificationSendResult>;
}

/** Deterministic, no network — always "delivers" (IN_APP has no real transport to fail; the content already lives in the database). */
export class MockNotificationProvider implements NotificationProvider {
  readonly name = "mock";

  async send(_payload: NotificationPayload): Promise<NotificationSendResult> {
    void _payload;
    return { delivered: true };
  }
}
