import { describe, expect, it } from 'vitest'
import { LiveVoiceApi, LiveVoiceApiError, RATE_LIMIT_PER_HOUR, RequestBudget, type FetchLike } from '../api.js'

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('RequestBudget', () => {
	it('keeps a reserve for actions and forgets requests older than an hour', () => {
		let now = 0
		const budget = new RequestBudget(() => now)
		for (let i = 0; i < RATE_LIMIT_PER_HOUR - 40; i++) {
			now += 13_000 // weit unter 60/min
			budget.record()
		}
		expect(budget.canSpend(40)).toBe(false)
		expect(budget.canSpend(0)).toBe(true)
		now += 3_600_000
		expect(budget.usedLastHour()).toBe(0)
		expect(budget.canSpend(40)).toBe(true)
	})

	it('respects the per-minute limit', () => {
		const budget = new RequestBudget(() => 1_000)
		for (let i = 0; i < 60; i++) budget.record()
		expect(budget.canSpend(0)).toBe(false)
	})

	it('blocks until after the next full minute when rate limited', () => {
		let now = 90_000
		const budget = new RequestBudget(() => now)
		budget.markRateLimited()
		expect(budget.canSpend()).toBe(false)
		now = 122_001
		expect(budget.canSpend()).toBe(true)
	})
})

describe('LiveVoiceApi', () => {
	it('sends the bearer key and unwraps the response', async () => {
		const calls: { url: string; init: RequestInit }[] = []
		const fetchMock: FetchLike = async (url, init) => {
			calls.push({ url, init })
			return jsonResponse(200, { status: 'success', channels: [{ id: 1, event_id: 2, name: 'A', state: 'offline' }] })
		}
		const api = new LiveVoiceApi('secret-key', { fetch: fetchMock })
		const channels = await api.listChannels(2)

		expect(channels).toHaveLength(1)
		expect(calls[0].url).toBe('https://livevoice.io/api/v2/events/2/channels')
		expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')
	})

	it('maps API errors to LiveVoiceApiError codes', async () => {
		const api = new LiveVoiceApi('k', {
			fetch: async () => jsonResponse(422, { status: 'error', error: 'already_in_state' }),
		})
		await expect(api.channelCommand(5, 'start-import')).rejects.toMatchObject({
			code: 'already_in_state',
			httpStatus: 422,
		})
	})

	it('flags auth errors', async () => {
		const api = new LiveVoiceApi('k', {
			fetch: async () => jsonResponse(401, { status: 'error', error: 'invalid_api_key' }),
		})
		const error = await api.getAccount().catch((e: unknown) => e)
		expect(error).toBeInstanceOf(LiveVoiceApiError)
		expect((error as LiveVoiceApiError).isAuthError).toBe(true)
	})

	it('handles a plain-text 429 and stops sending afterwards', async () => {
		let count = 0
		const api = new LiveVoiceApi('k', {
			fetch: async () => {
				count++
				return new Response('Rate limit exceeded', { status: 429 })
			},
		})
		await expect(api.listEvents()).rejects.toMatchObject({ code: 'rate_limited' })
		await expect(api.listEvents()).rejects.toMatchObject({ code: 'rate_limited' })
		expect(count).toBe(1)
	})
})
