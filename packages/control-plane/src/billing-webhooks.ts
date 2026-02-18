import type { BillingWebhookEvent } from '@autonomy/shared';

/** Pluggable interface for billing webhook handlers. */
export interface BillingWebhookHandler {
  onEvent(event: BillingWebhookEvent): void | Promise<void>;
}

/** Default handler that logs events to console. Products implement their own (Stripe, etc.). */
export class LogBillingWebhookHandler implements BillingWebhookHandler {
  onEvent(event: BillingWebhookEvent): void {
    console.log(`[billing] ${event.type}`, JSON.stringify(event.data));
  }
}
