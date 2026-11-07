import type { ApiChannel, ApiChannelPatch, ApiEvent } from './types.js'

export const API_BASE_URL = 'https://livevoice.io/api/v2'
const REQUEST_TIMEOUT_MS = 10_000

/** Limits der LiveVoice Server API (pro IP-Adresse). Abgelehnte Requests zählen ebenfalls. */
export const RATE_LIMIT_PER_MINUTE = 60
export const RATE_LIMIT_PER_HOUR = 300

export type ApiErrorCode =
	| 'invalid_api_key'
	| 'disabled_api'
	| 'feature_not_available'
	| 'user_banned'
	| 'not_found'
	| 'already_in_state'
	| 'not_in_state'
	| 'not_configured'
	| 'rate_limited'
	| 'budget_exhausted'
	| 'network'
	| 'http'
	| (string & {})

export class LiveVoiceApiError extends Error {
	constructor(
		public readonly code: ApiErrorCode,
		message: string,
		public readonly httpStatus?: number,
		public readonly details?: unknown,
	) {
		super(message)
		this.name = 'LiveVoiceApiError'
	}

	get isAuthError(): boolean {
		return this.code === 'invalid_api_key' || this.code === 'disabled_api' || this.code === 'user_banned'
	}
}

/**
 * Buchhaltung über die eigenen Requests, damit das Modul die API-Limits nicht reisst: Polling hält eine
 * Reserve frei, damit Button-Aktionen auch bei knappem Stundenbudget noch durchgehen. Nach einem 429 wird
 * bis zum Ablauf der Sperre gar nichts mehr gesendet (abgelehnte Requests zählen bei LiveVoice mit).
 */
export class RequestBudget {
	private readonly timestamps: number[] = []
	private blockedUntil = 0

	constructor(private readonly now: () => number = Date.now) {}

	private prune(): void {
		const hourAgo = this.now() - 3_600_000
		while (this.timestamps.length > 0 && this.timestamps[0] <= hourAgo) this.timestamps.shift()
	}

	usedLastHour(): number {
		this.prune()
		return this.timestamps.length
	}

	usedLastMinute(): number {
		const minuteAgo = this.now() - 60_000
		return this.timestamps.filter((t) => t > minuteAgo).length
	}

	/** Millisekunden bis zur Freigabe nach einem 429, sonst 0. */
	blockedForMs(): number {
		return Math.max(0, this.blockedUntil - this.now())
	}

	/** Darf ein Request gesendet werden? `reserve` = so viele Requests pro Stunde bleiben für Wichtigeres frei. */
	canSpend(reserve = 0): boolean {
		if (this.blockedForMs() > 0) return false
		if (this.usedLastMinute() >= RATE_LIMIT_PER_MINUTE - Math.min(reserve, 10)) return false
		return this.usedLastHour() < RATE_LIMIT_PER_HOUR - reserve
	}

	record(): void {
		this.timestamps.push(this.now())
	}

	/** Nach einem 429: bis zur nächsten vollen Minute sperren, bei ausgeschöpftem Stundenbudget länger. */
	markRateLimited(): void {
		const now = this.now()
		const nextMinute = Math.ceil((now + 1) / 60_000) * 60_000
		let until = nextMinute + 2_000
		if (this.usedLastHour() >= RATE_LIMIT_PER_HOUR - 5 && this.timestamps.length > 0) {
			until = Math.max(until, this.timestamps[0] + 3_600_000 + 2_000)
		}
		this.blockedUntil = until
	}
}

export interface ApiStatistics {
	current_participants?: number
	peak_participants?: number
}

export interface ApiAccount {
	id: number
	email?: string
	name?: string
	tier?: string | null
	features?: string[]
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** Dünner, typisierter Client für die LiveVoice Server API v2 - ohne Companion-Abhängigkeit (testbar). */
export class LiveVoiceApi {
	readonly budget: RequestBudget

	constructor(
		private readonly apiKey: string,
		options: { budget?: RequestBudget; fetch?: FetchLike; baseUrl?: string } = {},
	) {
		this.budget = options.budget ?? new RequestBudget()
		this.fetchImpl = options.fetch ?? (async (input, init) => fetch(input, init))
		this.baseUrl = options.baseUrl ?? API_BASE_URL
	}

	private readonly fetchImpl: FetchLike
	private readonly baseUrl: string

	/**
	 * @param reserve Anzahl Requests/Stunde, die für Aktionen frei bleiben müssen. Ist das Budget dafür zu
	 *   knapp, wird nicht gesendet, sondern `budget_exhausted` geworfen.
	 */
	async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, reserve = 0, payload?: unknown): Promise<T> {
		const blocked = this.budget.blockedForMs()
		if (blocked > 0) {
			throw new LiveVoiceApiError(
				'rate_limited',
				`API-Limit erreicht, nächster Versuch in ${Math.ceil(blocked / 1000)} s`,
				429,
			)
		}
		if (!this.budget.canSpend(reserve)) {
			throw new LiveVoiceApiError('budget_exhausted', 'Request-Budget (60/min, 300/h) fast aufgebraucht')
		}

		this.budget.record()
		let response: Response
		try {
			response = await this.fetchImpl(`${this.baseUrl}${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					Accept: 'application/json',
					...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
				},
				body: method !== 'GET' ? JSON.stringify(payload ?? {}) : undefined,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			})
		} catch (error) {
			throw new LiveVoiceApiError('network', `Netzwerkfehler: ${(error as Error).message}`)
		}

		if (response.status === 429) {
			this.budget.markRateLimited()
			const text = await response.text().catch(() => '')
			throw new LiveVoiceApiError('rate_limited', `API-Limit erreicht (429)${text ? `: ${text.trim()}` : ''}`, 429)
		}

		let body: unknown
		try {
			body = await response.json()
		} catch {
			throw new LiveVoiceApiError('http', `Unerwartete Antwort (HTTP ${response.status}, kein JSON)`, response.status)
		}

		const parsed = body as { status?: string; error?: string; details?: unknown }
		if (!response.ok || parsed.status === 'error') {
			const code = parsed.error ?? 'http'
			const detail = parsed.details !== undefined ? `: ${JSON.stringify(parsed.details).slice(0, 300)}` : ''
			throw new LiveVoiceApiError(code, describeError(code, response.status) + detail, response.status, parsed.details)
		}
		return body as T
	}

	async getAccount(): Promise<ApiAccount> {
		return (await this.request<{ account: ApiAccount }>('GET', '/account')).account
	}

	async listEvents(reserve = 0): Promise<ApiEvent[]> {
		return (await this.request<{ events: ApiEvent[] }>('GET', '/events', reserve)).events ?? []
	}

	async getEvent(eventId: number, reserve = 0): Promise<ApiEvent> {
		return (await this.request<{ event: ApiEvent }>('GET', `/events/${eventId}`, reserve)).event
	}

	async listChannels(eventId: number, reserve = 0): Promise<ApiChannel[]> {
		return (
			(await this.request<{ channels: ApiChannel[] }>('GET', `/events/${eventId}/channels`, reserve)).channels ?? []
		)
	}

	async getChannel(channelId: number, reserve = 0): Promise<ApiChannel> {
		return (await this.request<{ channel: ApiChannel }>('GET', `/channels/${channelId}`, reserve)).channel
	}

	async getEventStatistics(eventId: number, reserve = 0): Promise<ApiStatistics> {
		return (await this.request<{ statistics: ApiStatistics }>('GET', `/events/${eventId}/statistics`, reserve))
			.statistics
	}

	async getChannelStatistics(channelId: number, reserve = 0): Promise<ApiStatistics> {
		return (await this.request<{ statistics: ApiStatistics }>('GET', `/channels/${channelId}/statistics`, reserve))
			.statistics
	}

	async updateChannel(channelId: number, patch: ApiChannelPatch): Promise<ApiChannel> {
		return (await this.request<{ channel: ApiChannel }>('PATCH', `/channels/${channelId}`, 0, patch)).channel
	}

	async channelCommand(
		channelId: number,
		command: 'start-import' | 'stop-import' | 'start-ai' | 'stop-ai',
	): Promise<void> {
		await this.request('POST', `/channels/${channelId}/${command}`)
	}
}

export function describeError(code: string, httpStatus?: number): string {
	switch (code) {
		case 'invalid_api_key':
			return 'API-Key ungültig'
		case 'disabled_api':
			return 'Server-API ist für dieses LiveVoice-Konto deaktiviert'
		case 'user_banned':
			return 'LiveVoice-Konto gesperrt'
		case 'feature_not_available':
			return 'Funktion im LiveVoice-Plan nicht verfügbar'
		case 'not_found':
			return 'Nicht gefunden (Event/Channel existiert nicht oder gehört zu einem anderen Konto)'
		case 'already_in_state':
			return 'Channel ist bereits in diesem Zustand'
		case 'not_in_state':
			return 'Channel ist nicht im erwarteten Zustand'
		case 'not_configured':
			return 'Nicht konfiguriert (Import/AI für diesen Channel nicht eingerichtet oder keine AI-Minuten)'
		default:
			return `API-Fehler ${code}${httpStatus ? ` (HTTP ${httpStatus})` : ''}`
	}
}
