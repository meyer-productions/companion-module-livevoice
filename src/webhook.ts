import { createHmac, timingSafeEqual } from 'node:crypto'
import { parseApiState } from './state.js'
import type { ApiChannelState } from './types.js'

/** Maximal zulässiges Alter eines Webhook-Requests (Replay-Schutz laut API-Doku). */
export const WEBHOOK_MAX_AGE_SECONDS = 5 * 60

export type WebhookVerification = { ok: true } | { ok: false; reason: string }

function header(headers: Record<string, string>, name: string): string | undefined {
	const wanted = name.toLowerCase()
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === wanted) return value
	}
	return undefined
}

/**
 * Prüft die Signatur eines LiveVoice-Webhooks: HMAC-SHA256 über "{Webhook-Timestamp}.{roher Body}",
 * hex-codiert, Vergleich in konstanter Zeit, Ablehnung bei Requests älter als 5 Minuten.
 */
export function verifyWebhook(
	secret: string,
	headers: Record<string, string>,
	rawBody: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): WebhookVerification {
	const timestamp = header(headers, 'webhook-timestamp')
	const signature = header(headers, 'webhook-signature')
	if (!timestamp || !signature) return { ok: false, reason: 'Signatur-Header fehlen' }

	const ts = Number(timestamp)
	if (!Number.isFinite(ts)) return { ok: false, reason: 'ungültiger Zeitstempel' }
	if (Math.abs(nowSeconds - ts) > WEBHOOK_MAX_AGE_SECONDS) return { ok: false, reason: 'Zeitstempel zu alt' }

	const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
	const given = signature.trim().toLowerCase()
	const a = Buffer.from(expected, 'utf8')
	const b = Buffer.from(given, 'utf8')
	if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'Signatur stimmt nicht' }

	return { ok: true }
}

export interface ChannelStateChange {
	deliveryId: string
	eventId: number
	channelId: number
	oldState?: ApiChannelState
	newState: ApiChannelState
}

/** Liest einen `channel_state_changed`-Payload; `undefined` bei anderen Events oder unbrauchbaren Daten. */
export function parseChannelStateChange(rawBody: string): ChannelStateChange | undefined {
	let body: unknown
	try {
		body = JSON.parse(rawBody)
	} catch {
		return undefined
	}
	if (typeof body !== 'object' || body === null) return undefined
	const payload = body as { id?: unknown; event?: unknown; data?: Record<string, unknown> }
	if (payload.event !== 'channel_state_changed' || typeof payload.data !== 'object' || payload.data === null) {
		return undefined
	}

	const { event_id, channel_id, old_state, new_state } = payload.data
	const newState = parseApiState(new_state)
	if (typeof event_id !== 'number' || typeof channel_id !== 'number' || newState === undefined) return undefined

	return {
		deliveryId: typeof payload.id === 'string' ? payload.id : '',
		eventId: event_id,
		channelId: channel_id,
		oldState: parseApiState(old_state),
		newState,
	}
}
