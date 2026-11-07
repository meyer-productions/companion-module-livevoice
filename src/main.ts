import {
	InstanceBase,
	InstanceStatus,
	type CompanionHTTPRequest,
	type CompanionHTTPResponse,
	type DropdownChoice,
	type SomeCompanionConfigField,
} from '@companion-module/base'
import {
	DEFAULT_POLL_INTERVAL,
	DEFAULT_STATS_INTERVAL,
	GetConfigFields,
	MIN_POLL_INTERVAL,
	WEBHOOK_POLL_INTERVAL,
	type ModuleConfig,
	type ModuleSecrets,
} from './config.js'
import { UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { RequestBudget, type LiveVoiceApiError } from './api.js'
import { LiveVoiceClient } from './livevoice-client.js'
import { selectDefaultImportChannel } from './state.js'
import { parseChannelStateChange, verifyWebhook } from './webhook.js'
import { isInputLanguage } from './languages.js'
import type { ApiEvent, LiveVoiceChannel } from './types.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

const WEBHOOK_PATH = '/webhook'
const STATE_FEEDBACKS = [
	'sourceLanguage',
	'importActive',
	'importInactive',
	'importOffline',
	'importUnknown',
	'aiActive',
	'channelState',
] as const

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	secrets!: ModuleSecrets // Setup in init()

	/** Über Neukonfigurationen hinweg geteilt, damit das Rate-Limit-Budget nicht zurückgesetzt wird. */
	private readonly budget = new RequestBudget()
	readonly client: LiveVoiceClient

	private knownEvents: ApiEvent[] = []
	private budgetTimer?: ReturnType<typeof setInterval>

	constructor(internal: unknown) {
		super(internal)
		this.client = new LiveVoiceClient({
			budget: this.budget,
			debug: (message) => {
				if (this.config?.debugLogging) this.log('debug', message)
			},
			warn: (message) => this.log('warn', message),
		})
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		this.config = config
		this.secrets = secrets

		this.setVariableValues({
			connection_status: 'connecting',
			event_name: '',
			event_id: '',
			join_code: '',
			participant_url: '',
			event_listener_count: 0,
			import_channel_name: '',
			import_channel_id: '',
			import_state: 'unknown',
			channel_state: '',
			source_language: '',
			listener_count: 0,
			api_requests_last_hour: 0,
		})

		this.registerClientEvents()
		this.updateDefinitions()
		this.budgetTimer = setInterval(() => {
			this.setVariableValues({ api_requests_last_hour: this.budget.usedLastHour() })
		}, 15_000)
		await this.connect()
	}

	async destroy(): Promise<void> {
		clearInterval(this.budgetTimer)
		this.client.stop()
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		const reconnect = this.secrets?.apiKey !== secrets.apiKey || this.config?.eventId !== config.eventId
		this.config = config
		this.secrets = secrets

		this.updateDefinitions()
		if (reconnect) {
			await this.connect()
		} else {
			this.client.updateIntervals(this.pollIntervalMs(), this.statsIntervalMs())
			this.updateSelectedChannelVariables()
		}
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields({
			events: this.knownEvents,
			channels: this.sortedChannels(),
			webhookPath: `/instance/${this.label}${WEBHOOK_PATH}`,
		})
	}

	/** Empfängt LiveVoice-Webhooks unter /instance/<Verbindungsname>/webhook. */
	async handleHttpRequest(request: CompanionHTTPRequest): Promise<CompanionHTTPResponse> {
		if (request.path !== WEBHOOK_PATH) return { status: 404, body: 'Not found' }
		if (request.method.toUpperCase() !== 'POST') return { status: 405, body: 'Method not allowed' }

		const secret = this.secrets?.webhookSecret ?? ''
		if (!this.config?.webhookEnabled || secret.length < 32) {
			return { status: 503, body: 'Webhook not enabled' }
		}

		const rawBody = request.body ?? ''
		const verification = verifyWebhook(secret, request.headers, rawBody)
		if (!verification.ok) {
			this.log('warn', `Webhook abgelehnt (${verification.reason}) von ${request.ip}`)
			return { status: 401, body: 'Invalid signature' }
		}

		const change = parseChannelStateChange(rawBody)
		if (!change) {
			// Unbekannte Events trotzdem quittieren, sonst wiederholt LiveVoice sie und mailt dem Konto-Inhaber.
			if (this.config.debugLogging) this.log('debug', 'Webhook ohne channel_state_changed-Daten ignoriert')
			return { status: 204 }
		}
		this.client.applyWebhook(change)
		return { status: 204 }
	}

	private updateDefinitions(): void {
		UpdateActions(this)
		UpdateFeedbacks(this)
		UpdatePresets(this)
		UpdateVariableDefinitions(this)
	}

	private pollIntervalMs(): number {
		const configured = Math.max(MIN_POLL_INTERVAL, Number(this.config.pollInterval) || DEFAULT_POLL_INTERVAL)
		const seconds = this.config.webhookEnabled ? Math.max(configured, WEBHOOK_POLL_INTERVAL) : configured
		return seconds * 1000
	}

	private statsIntervalMs(): number {
		const raw = Number(this.config.statsInterval ?? DEFAULT_STATS_INTERVAL)
		if (!Number.isFinite(raw) || raw <= 0) return 0
		return Math.max(MIN_POLL_INTERVAL * 2, raw) * 1000
	}

	private sortedChannels(): LiveVoiceChannel[] {
		return Array.from(this.client.getEvent().channels.values()).sort((a, b) => a.name.localeCompare(b.name))
	}

	/** Dropdown-Choices für Import-Optionen: "Auto" plus alle Channels des aktuellen Events. */
	getChannelActionChoices(): DropdownChoice[] {
		return [
			{ id: 'auto', label: 'Auto / Quellkanal' },
			...this.sortedChannels().map((channel) => ({ id: String(channel.id), label: `${channel.name} (${channel.id})` })),
		]
	}

	/** Dropdown-Choices für AI-Optionen: nur Channels mit aktivierter AI-Übersetzung. */
	getAiChannelChoices(): DropdownChoice[] {
		return this.sortedChannels()
			.filter((channel) => channel.hasAiTranslation)
			.map((channel) => ({ id: String(channel.id), label: `${channel.name} (${channel.id})` }))
	}

	/** Löst "auto"/leer über den bevorzugten bzw. automatisch erkannten Channel auf, sonst eine konkrete ID. */
	resolveChannelId(value: string): number | undefined {
		const channels = Array.from(this.client.getEvent().channels.values())
		if (!value || value === 'auto') {
			const preferred = this.config?.preferredChannelId
			if (preferred && preferred !== 'auto') {
				const id = Number(preferred)
				if (channels.some((channel) => channel.id === id)) return id
			}
			return selectDefaultImportChannel(channels)?.id
		}
		const numeric = Number(value)
		if (!Number.isFinite(numeric)) return undefined
		return channels.some((channel) => channel.id === numeric) ? numeric : undefined
	}

	resolveAiChannelId(value: string): number | undefined {
		const numeric = Number(value)
		if (!value || !Number.isFinite(numeric)) return undefined
		return this.client.getChannel(numeric)?.hasAiTranslation ? numeric : undefined
	}

	/** Schaltet nur um, wenn der tatsächliche Serverstatus eindeutig ist. */
	async toggleImport(channelId: number): Promise<void> {
		const channel = this.client.getChannel(channelId)
		if (!channel || channel.importState === 'unknown') {
			this.log(
				'warn',
				`Import umschalten: Status von Channel ${channelId} ist unbekannt, Aktion wird nicht ausgeführt.`,
			)
			return
		}
		await this.client.command(channelId, channel.importState === 'active' ? 'stop-import' : 'start-import')
	}

	async toggleAi(channelId: number): Promise<void> {
		const channel = this.client.getChannel(channelId)
		if (!channel?.state) {
			this.log('warn', `AI umschalten: Status von Channel ${channelId} ist unbekannt, Aktion wird nicht ausgeführt.`)
			return
		}
		await this.client.command(channelId, channel.state === 'ai_translating' ? 'stop-ai' : 'start-ai')
	}

	async setSourceLanguage(channelId: number, language: string, manageHiding: boolean): Promise<void> {
		if (!isInputLanguage(language)) {
			this.log('warn', `Ursprungssprache setzen: unbekannte Sprache "${language}"`)
			return
		}
		const name = this.client.getChannel(channelId)?.name ?? String(channelId)
		try {
			const changes = await this.client.setSourceLanguage(channelId, language, manageHiding)
			if (changes.length === 0) this.log('info', `Ursprungssprache: ${name} ist bereits auf ${language}`)
			for (const line of changes) this.log('info', `Ursprungssprache ${language}: ${line}`)
		} catch (error) {
			this.log('warn', `Ursprungssprache ${language} (${name}): ${(error as Error).message}`)
		}
	}

	private async connect(): Promise<void> {
		const apiKey = this.secrets?.apiKey?.trim()
		if (!apiKey) {
			this.client.stop()
			this.updateStatus(InstanceStatus.BadConfig, 'API-Key fehlt')
			this.setVariableValues({ connection_status: 'error' })
			return
		}
		const eventId = this.config.eventId && this.config.eventId !== 'auto' ? Number(this.config.eventId) : undefined
		if (eventId !== undefined && !Number.isInteger(eventId)) {
			this.client.stop()
			this.updateStatus(InstanceStatus.BadConfig, 'Event-ID ungültig')
			return
		}

		this.updateStatus(InstanceStatus.Connecting, 'Verbinde mit LiveVoice API...')
		this.setVariableValues({ connection_status: 'connecting' })
		await this.client.start({
			apiKey,
			eventId,
			pollIntervalMs: this.pollIntervalMs(),
			statsIntervalMs: this.statsIntervalMs(),
			statsChannelId: () => this.resolveChannelId('auto'),
		})
	}

	private registerClientEvents(): void {
		this.client.on('events', (events) => {
			this.knownEvents = events
		})

		this.client.on('connected', () => {
			const event = this.client.getEvent()
			this.updateStatus(InstanceStatus.Ok, event.name ?? 'Verbunden')
			this.setVariableValues({ connection_status: 'ok' })
			this.checkFeedbacks('connected')
		})

		this.client.on('disconnected', (reason) => {
			this.updateStatus(InstanceStatus.ConnectionFailure, reason)
			this.setVariableValues({ connection_status: 'disconnected' })
			this.checkFeedbacks('connected', ...STATE_FEEDBACKS)
			this.updateSelectedChannelVariables()
		})

		this.client.on('event', (eventState) => {
			this.log('info', `Event: ${eventState.name ?? 'unbekannt'} (${eventState.eventId ?? '-'})`)
			for (const channel of eventState.channels.values()) {
				this.log('info', `Channel: ${channel.name} (${channel.id}) - ${channel.state ?? 'unbekannt'}`)
			}
			this.setVariableValues({
				event_name: eventState.name ?? '',
				event_id: eventState.eventId !== undefined ? String(eventState.eventId) : '',
				join_code: eventState.joinCode ?? '',
				participant_url: eventState.participantUrl ?? '',
			})
			this.updateDefinitions()
			this.updateSelectedChannelVariables()
			this.checkFeedbacks(...STATE_FEEDBACKS, 'listenerCountCompare', 'connected')
		})

		this.client.on('channelUpdated', () => {
			this.updateSelectedChannelVariables()
			this.checkFeedbacks(...STATE_FEEDBACKS)
		})

		this.client.on('statistics', () => {
			this.setVariableValues({ event_listener_count: this.client.getEvent().listeners ?? 0 })
			this.updateSelectedChannelVariables()
			this.checkFeedbacks('listenerCountCompare')
		})

		this.client.on('error', (error: LiveVoiceApiError) => {
			this.log('warn', `LiveVoice: ${error.message}`)
			this.setVariableValues({ connection_status: 'error' })
			if (error.isAuthError) {
				this.updateStatus(InstanceStatus.AuthenticationFailure, error.message)
			} else if (error.code === 'no_event_selected' || error.code === 'not_found') {
				this.updateStatus(InstanceStatus.BadConfig, error.message)
			} else {
				this.updateStatus(InstanceStatus.ConnectionFailure, error.message)
			}
		})
	}

	private updateSelectedChannelVariables(): void {
		const channelId = this.resolveChannelId('auto')
		const channel = channelId !== undefined ? this.client.getChannel(channelId) : undefined

		this.setVariableValues({
			import_channel_name: channel?.name ?? '',
			import_channel_id: channel !== undefined ? String(channel.id) : '',
			import_state: channel?.importState ?? 'unknown',
			channel_state: channel?.state ?? '',
			source_language: channel?.spokenLanguages.join(',') ?? '',
			listener_count: channel?.listeners ?? 0,
			api_requests_last_hour: this.budget.usedLastHour(),
		})
	}
}
