import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseChannelStateChange, verifyWebhook } from '../webhook.js'

const SECRET = 'x'.repeat(40)
const BODY = JSON.stringify({
	id: '7f0c2c43-0000-4000-8000-000000000001',
	event: 'channel_state_changed',
	occurred_at: '2026-11-07T10:00:00Z',
	sent_at: '2026-11-07T10:00:01Z',
	data: { event_id: 10, channel_id: 20, old_state: 'offline', new_state: 'importing_source' },
})

function sign(timestamp: string, body: string, secret = SECRET): string {
	return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

describe('verifyWebhook', () => {
	const now = 1_800_000_000
	const ts = String(now)

	it('accepts a correctly signed request (header names case-insensitive)', () => {
		expect(verifyWebhook(SECRET, { 'webhook-timestamp': ts, 'Webhook-Signature': sign(ts, BODY) }, BODY, now)).toEqual({
			ok: true,
		})
	})

	it('rejects a wrong secret, a modified body and missing headers', () => {
		expect(
			verifyWebhook(SECRET, { 'webhook-timestamp': ts, 'webhook-signature': sign(ts, BODY, 'y'.repeat(40)) }, BODY, now)
				.ok,
		).toBe(false)
		expect(
			verifyWebhook(SECRET, { 'webhook-timestamp': ts, 'webhook-signature': sign(ts, BODY) }, BODY + ' ', now).ok,
		).toBe(false)
		expect(verifyWebhook(SECRET, {}, BODY, now).ok).toBe(false)
	})

	it('rejects requests older than 5 minutes (replay protection)', () => {
		const old = String(now - 301)
		expect(
			verifyWebhook(SECRET, { 'webhook-timestamp': old, 'webhook-signature': sign(old, BODY) }, BODY, now),
		).toEqual({
			ok: false,
			reason: 'Zeitstempel zu alt',
		})
	})
})

describe('parseChannelStateChange', () => {
	it('parses a channel_state_changed payload', () => {
		expect(parseChannelStateChange(BODY)).toEqual({
			deliveryId: '7f0c2c43-0000-4000-8000-000000000001',
			eventId: 10,
			channelId: 20,
			oldState: 'offline',
			newState: 'importing_source',
		})
	})

	it('ignores invalid JSON, other events and unknown states', () => {
		expect(parseChannelStateChange('nope')).toBeUndefined()
		expect(parseChannelStateChange(JSON.stringify({ event: 'other', data: {} }))).toBeUndefined()
		expect(
			parseChannelStateChange(
				JSON.stringify({ event: 'channel_state_changed', data: { event_id: 1, channel_id: 2, new_state: 'flying' } }),
			),
		).toBeUndefined()
	})
})
