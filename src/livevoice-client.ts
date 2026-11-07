import { EventEmitter } from 'node:events'
import { LiveVoiceApi, LiveVoiceApiError, type RequestBudget } from './api.js'
import {
	mapImportState,
	planSourceLanguageChange,
	planVoiceChange,
	toChannel,
	type ChannelChangePlan,
} from './state.js'
import type { AiVoice, ApiEvent, LiveVoiceChannel, LiveVoiceEventState } from './types.js'
import type { ChannelStateChange } from './webhook.js'

/** So viele Requests pro Stunde hält das Polling für Button-Aktionen frei. */
const ACTION_RESERVE = 40
/** Für Nachkontrollen direkt nach einer Aktion (kleinere Reserve als normales Polling). */
const FOLLOWUP_RESERVE = 15
const FOLLOWUP_DELAYS_MS = [1_500, 5_000]
const ERROR_RETRY_MS = 30_000

export type CommandName = 'start-import' | 'stop-import' | 'start-ai' | 'stop-ai'

export interface ClientOptions {
	apiKey: string
	/** Gewähltes Event; `undefined` = automatisch, falls das Konto genau ein aktives Event hat. */
	eventId?: number
	pollIntervalMs: number
	/** 0 = Teilnehmerzahlen nicht abfragen. */
	statsIntervalMs: number
	/** Channel, dessen Teilnehmerzahl zusätzlich zum Event abgefragt wird. */
	statsChannelId?: () => number | undefined
}

type ClientEvents = {
	/** Event-Liste des Kontos (für das Config-Dropdown). */
	events: [events: ApiEvent[]]
	connected: []
	disconnected: [reason: string]
	/** Event-Stammdaten oder Channel-Liste haben sich geändert (Dropdowns neu aufbauen). */
	event: [state: LiveVoiceEventState]
	channelUpdated: [channel: LiveVoiceChannel]
	statistics: []
	error: [error: LiveVoiceApiError]
}

/**
 * Hält den Zustand eines LiveVoice-Events über die Server API v2 aktuell (Polling mit Rate-Limit-Budget,
 * optional ergänzt durch Webhooks) und führt Channel-Befehle aus. Bewusst ohne Companion-Import.
 */
export class LiveVoiceClient extends EventEmitter {
	private api?: LiveVoiceApi
	private options?: ClientOptions
	private generation = 0
	private pollTimer?: ReturnType<typeof setTimeout>
	private statsTimer?: ReturnType<typeof setTimeout>
	private readonly followupTimers = new Set<ReturnType<typeof setTimeout>>()
	private eventState: LiveVoiceEventState = { channels: new Map() }
	private online = false
	private stopped = true
	private lastBudgetWarning = 0
	private readonly seenDeliveries: string[] = []
	private configChangeRunning = false

	constructor(
		private readonly hooks: {
			debug?: (message: string) => void
			warn?: (message: string) => void
			budget?: RequestBudget
		} = {},
	) {
		super()
	}

	override on<K extends keyof ClientEvents>(event: K, listener: (...args: ClientEvents[K]) => void): this {
		return super.on(event, listener as (...args: unknown[]) => void)
	}

	override emit<K extends keyof ClientEvents>(event: K, ...args: ClientEvents[K]): boolean {
		return super.emit(event, ...args)
	}

	private debug(message: string): void {
		this.hooks.debug?.(message)
	}

	getEvent(): LiveVoiceEventState {
		return this.eventState
	}

	getChannel(channelId: number): LiveVoiceChannel | undefined {
		return this.eventState.channels.get(channelId)
	}

	isConnected(): boolean {
		return this.online
	}

	requestsLastHour(): number {
		return this.api?.budget.usedLastHour() ?? 0
	}

	/** Startet (neu). Wirft nie - Fehler kommen über das `error`-Event. */
	async start(options: ClientOptions): Promise<void> {
		this.stop()
		this.stopped = false
		this.options = options
		this.api = new LiveVoiceApi(options.apiKey, { budget: this.hooks.budget })
		this.eventState = { channels: new Map() }
		const generation = ++this.generation
		await this.bootstrap(generation)
	}

	stop(): void {
		this.stopped = true
		this.generation++
		clearTimeout(this.pollTimer)
		clearTimeout(this.statsTimer)
		for (const timer of this.followupTimers) clearTimeout(timer)
		this.followupTimers.clear()
		this.setOnline(false, 'gestoppt')
	}

	/** Passt nur die Intervalle an, ohne neu zu verbinden. */
	updateIntervals(pollIntervalMs: number, statsIntervalMs: number): void {
		if (!this.options) return
		const statsWasOff = this.options.statsIntervalMs <= 0
		this.options.pollIntervalMs = pollIntervalMs
		this.options.statsIntervalMs = statsIntervalMs
		if (this.stopped || this.eventState.eventId === undefined) return
		this.schedulePoll(this.generation, pollIntervalMs)
		if (statsIntervalMs > 0 && statsWasOff) this.scheduleStats(this.generation, 0)
		if (statsIntervalMs <= 0) clearTimeout(this.statsTimer)
	}

	/** Fragt den Channel-Status sofort ab (z.B. per Button); danach läuft das normale Intervall weiter. */
	async refreshNow(): Promise<void> {
		if (this.stopped) return
		if (this.eventState.eventId === undefined) {
			await this.bootstrap(this.generation)
			return
		}
		clearTimeout(this.pollTimer)
		await this.pollChannels(this.generation)
	}

	private isCurrent(generation: number): boolean {
		return !this.stopped && generation === this.generation
	}

	private setOnline(online: boolean, reason = ''): void {
		if (this.online === online) return
		this.online = online
		if (online) this.emit('connected')
		else this.emit('disconnected', reason)
	}

	private async bootstrap(generation: number): Promise<void> {
		const api = this.api
		const options = this.options
		if (!api || !options) return
		clearTimeout(this.pollTimer)

		try {
			const events = await api.listEvents(ACTION_RESERVE)
			if (!this.isCurrent(generation)) return
			this.emit('events', events)

			let eventId = options.eventId
			if (eventId === undefined) {
				const usable = events.filter((event) => event.state !== 'stale')
				const active = usable.filter((event) => event.state === 'active')
				const candidates = active.length > 0 ? active : usable
				if (candidates.length !== 1) {
					this.emit(
						'error',
						new LiveVoiceApiError(
							'no_event_selected',
							candidates.length === 0
								? 'Keine Events im LiveVoice-Konto gefunden'
								: `${candidates.length} Events gefunden - bitte in der Konfiguration ein Event wählen`,
						),
					)
					return
				}
				eventId = candidates[0].id
			}

			const event =
				events.find((candidate) => candidate.id === eventId) ?? (await api.getEvent(eventId, ACTION_RESERVE))
			if (!this.isCurrent(generation)) return
			this.eventState = {
				eventId: event.id,
				name: event.name,
				joinCode: event.code,
				participantUrl: event.participant_url,
				channels: new Map(),
			}
			this.debug(`Event gewählt: ${event.name} (${event.id})`)

			await this.pollChannels(generation)
			if (!this.isCurrent(generation)) return
			if (options.statsIntervalMs > 0) this.scheduleStats(generation, 0)
		} catch (error) {
			if (!this.isCurrent(generation)) return
			this.handleError(error)
			if (!isFatal(error)) {
				this.setOnline(false, (error as Error).message)
				this.pollTimer = setTimeout(() => void this.bootstrap(generation), retryDelay(error, api))
			}
		}
	}

	private schedulePoll(generation: number, delayMs: number): void {
		clearTimeout(this.pollTimer)
		this.pollTimer = setTimeout(() => void this.pollChannels(generation), delayMs)
	}

	private scheduleStats(generation: number, delayMs: number): void {
		clearTimeout(this.statsTimer)
		this.statsTimer = setTimeout(() => void this.pollStatistics(generation), delayMs)
	}

	private async pollChannels(generation: number): Promise<void> {
		const api = this.api
		const options = this.options
		const eventId = this.eventState.eventId
		if (!api || !options || eventId === undefined || !this.isCurrent(generation)) return

		let next = options.pollIntervalMs
		try {
			const channels = await api.listChannels(eventId, ACTION_RESERVE)
			if (!this.isCurrent(generation)) return
			this.applyChannels(channels.map((raw) => toChannel(raw, this.eventState.channels.get(raw.id))))
			this.setOnline(true)
		} catch (error) {
			if (!this.isCurrent(generation)) return
			if (isFatal(error)) {
				this.handleError(error)
				this.setOnline(false, (error as Error).message)
				return
			}
			if (isBudgetError(error)) {
				this.warnBudget(error as LiveVoiceApiError)
			} else {
				this.handleError(error)
				this.setOnline(false, (error as Error).message)
				this.markAllUnknown()
			}
			next = Math.max(next, retryDelay(error, api))
		}
		this.schedulePoll(generation, next)
	}

	private async pollStatistics(generation: number): Promise<void> {
		const api = this.api
		const options = this.options
		const eventId = this.eventState.eventId
		if (!api || !options || eventId === undefined || !this.isCurrent(generation) || options.statsIntervalMs <= 0) return

		let next = options.statsIntervalMs
		try {
			const eventStats = await api.getEventStatistics(eventId, ACTION_RESERVE)
			if (!this.isCurrent(generation)) return
			this.eventState.listeners = eventStats.current_participants ?? 0

			const channelId = options.statsChannelId?.()
			const channel = channelId !== undefined ? this.eventState.channels.get(channelId) : undefined
			if (channel) {
				const channelStats = await api.getChannelStatistics(channel.id, ACTION_RESERVE)
				if (!this.isCurrent(generation)) return
				channel.listeners = channelStats.current_participants ?? 0
			}
			this.emit('statistics')
		} catch (error) {
			if (!this.isCurrent(generation)) return
			if (isBudgetError(error)) this.warnBudget(error as LiveVoiceApiError)
			else if (!isFatal(error)) this.debug(`Statistik-Abruf fehlgeschlagen: ${(error as Error).message}`)
			next = Math.max(next, retryDelay(error, api))
		}
		this.scheduleStats(generation, next)
	}

	private applyChannels(channels: LiveVoiceChannel[]): void {
		const previous = this.eventState.channels
		const structureChanged =
			previous.size !== channels.length ||
			channels.some((channel) => {
				const old = previous.get(channel.id)
				return (
					!old ||
					old.name !== channel.name ||
					old.hasAudioInput !== channel.hasAudioInput ||
					old.hasAiTranslation !== channel.hasAiTranslation ||
					old.hidden !== channel.hidden ||
					old.spokenLanguages.join(',') !== channel.spokenLanguages.join(',') ||
					(old.aiLanguages ?? []).join(',') !== (channel.aiLanguages ?? []).join(',')
				)
			})

		const changed = channels.filter((channel) => previous.get(channel.id)?.state !== channel.state)
		this.eventState.channels = new Map(channels.map((channel) => [channel.id, channel]))

		if (structureChanged) {
			this.emit('event', this.eventState)
			return
		}
		for (const channel of changed) {
			this.debug(
				`Channel ${channel.name} (${channel.id}): ${previous.get(channel.id)?.state ?? '?'} -> ${channel.state ?? '?'}`,
			)
			this.emit('channelUpdated', channel)
		}
	}

	private markAllUnknown(): void {
		for (const channel of this.eventState.channels.values()) {
			if (channel.importState === 'unknown') continue
			channel.state = undefined
			channel.importState = 'unknown'
			this.emit('channelUpdated', channel)
		}
	}

	/** Verarbeitet einen (bereits signaturgeprüften) Webhook. Gibt `false` zurück, wenn er ignoriert wurde. */
	applyWebhook(change: ChannelStateChange): boolean {
		if (change.deliveryId) {
			if (this.seenDeliveries.includes(change.deliveryId)) return false
			this.seenDeliveries.push(change.deliveryId)
			if (this.seenDeliveries.length > 100) this.seenDeliveries.shift()
		}
		if (change.eventId !== this.eventState.eventId) return false
		const channel = this.eventState.channels.get(change.channelId)
		if (!channel) {
			// Unbekannter Channel: beim nächsten Poll kommt er mit allen Stammdaten.
			this.schedulePoll(this.generation, 500)
			return true
		}
		if (channel.state !== change.newState) {
			this.debug(`Webhook: ${channel.name} (${channel.id}) ${channel.state ?? '?'} -> ${change.newState}`)
			channel.state = change.newState
			channel.importState = mapImportState(change.newState)
			this.emit('channelUpdated', channel)
		}
		return true
	}

	/**
	 * Führt einen Channel-Befehl aus. `already_in_state` gilt nicht als Fehler (Ziel ist ja erreicht).
	 * Danach wird der Channel-Zustand gezielt nachgeladen, statt ihn aus dem Befehl abzuleiten.
	 */
	async command(channelId: number, command: CommandName): Promise<void> {
		const api = this.api
		if (!api) throw new LiveVoiceApiError('not_ready', 'Nicht mit LiveVoice verbunden')
		try {
			await api.channelCommand(channelId, command)
			this.debug(`${command} für Channel ${channelId} ok`)
		} catch (error) {
			if (error instanceof LiveVoiceApiError && error.code === 'already_in_state') {
				this.debug(`${command} für Channel ${channelId}: bereits im Zielzustand`)
			} else {
				throw error
			}
		} finally {
			this.scheduleFollowups(channelId)
		}
	}

	/** Stellt die Ursprungssprache um (siehe {@link planSourceLanguageChange}). */
	async setSourceLanguage(sourceId: number, language: string, manageHiding: boolean): Promise<string[]> {
		return this.runChannelPlans('Sprachumstellung', (channels) =>
			planSourceLanguageChange(channels, sourceId, language, manageHiding),
		)
	}

	/** Setzt die Stimme aller AI-Channels mit Sprachausgabe (siehe {@link planVoiceChange}). */
	async setVoice(voice: AiVoice): Promise<string[]> {
		return this.runChannelPlans('Stimmenwechsel', (channels) => planVoiceChange(channels, voice))
	}

	/**
	 * Lädt die Channels frisch, plant daraus die nötigen Änderungen und sendet nur diese (in Plan-Reihenfolge).
	 * Ein fehlgeschlagener Channel bricht die übrigen nicht ab; die Fehler werden gesammelt geworfen.
	 * @returns Log-Zeilen pro geändertem Channel
	 */
	private async runChannelPlans(
		label: string,
		planner: (channels: LiveVoiceChannel[]) => ChannelChangePlan[],
	): Promise<string[]> {
		const api = this.api
		const eventId = this.eventState.eventId
		if (!api || eventId === undefined) throw new LiveVoiceApiError('not_ready', 'Nicht mit LiveVoice verbunden')
		if (this.configChangeRunning) throw new LiveVoiceApiError('busy', `${label}: es läuft bereits eine Änderung`)

		this.configChangeRunning = true
		try {
			const fresh = (await api.listChannels(eventId)).map((raw) => toChannel(raw, this.eventState.channels.get(raw.id)))
			this.applyChannels(fresh)

			const plans = planner(fresh)
			const lines: string[] = []
			const errors: string[] = []
			for (const plan of plans) {
				try {
					const updated = await api.updateChannel(plan.channelId, plan.patch)
					this.eventState.channels.set(updated.id, toChannel(updated, this.eventState.channels.get(updated.id)))
					lines.push(`${plan.channelName}: ${plan.summary}`)
				} catch (error) {
					errors.push(`${plan.channelName}: ${(error as Error).message}`)
				}
			}
			if (plans.length > 0) this.emit('event', this.eventState)
			if (errors.length > 0) {
				throw new LiveVoiceApiError('partial', `Teilweise fehlgeschlagen - ${errors.join('; ')}`)
			}
			return lines
		} finally {
			this.configChangeRunning = false
		}
	}

	private scheduleFollowups(channelId: number): void {
		const generation = this.generation
		for (const delay of FOLLOWUP_DELAYS_MS) {
			const timer = setTimeout(() => {
				this.followupTimers.delete(timer)
				void this.refreshChannel(generation, channelId)
			}, delay)
			this.followupTimers.add(timer)
		}
	}

	private async refreshChannel(generation: number, channelId: number): Promise<void> {
		const api = this.api
		if (!api || !this.isCurrent(generation)) return
		try {
			const raw = await api.getChannel(channelId, FOLLOWUP_RESERVE)
			if (!this.isCurrent(generation)) return
			const previous = this.eventState.channels.get(channelId)
			const channel = toChannel(raw, previous)
			this.eventState.channels.set(channelId, channel)
			if (!previous) this.emit('event', this.eventState)
			else if (previous.state !== channel.state) this.emit('channelUpdated', channel)
		} catch (error) {
			if (isBudgetError(error)) this.warnBudget(error as LiveVoiceApiError)
			else this.debug(`Nachkontrolle Channel ${channelId} fehlgeschlagen: ${(error as Error).message}`)
		}
	}

	private warnBudget(error: LiveVoiceApiError): void {
		const now = Date.now()
		if (now - this.lastBudgetWarning < 5 * 60_000) return
		this.lastBudgetWarning = now
		this.hooks.warn?.(`Abfrage ausgelassen: ${error.message}. Polling-Intervall erhöhen oder Webhook nutzen.`)
	}

	private handleError(error: unknown): void {
		const apiError =
			error instanceof LiveVoiceApiError ? error : new LiveVoiceApiError('unknown', (error as Error).message)
		this.emit('error', apiError)
	}
}

function isFatal(error: unknown): boolean {
	return error instanceof LiveVoiceApiError && (error.isAuthError || error.code === 'not_found')
}

function isBudgetError(error: unknown): boolean {
	return error instanceof LiveVoiceApiError && (error.code === 'rate_limited' || error.code === 'budget_exhausted')
}

function retryDelay(error: unknown, api: LiveVoiceApi): number {
	if (isBudgetError(error)) return Math.max(api.budget.blockedForMs(), 60_000)
	return ERROR_RETRY_MS
}
