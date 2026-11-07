import type { DropdownChoice, SomeCompanionConfigField } from '@companion-module/base'
import type { ApiEvent, LiveVoiceChannel } from './types.js'

export type ModuleConfig = {
	/** Event-ID als String, "auto" = einziges aktives Event des Kontos. */
	eventId: string
	preferredChannelId: string
	/** Sekunden zwischen zwei Abfragen des Channel-Status. */
	pollInterval: number
	/** Sekunden zwischen zwei Abfragen der Teilnehmerzahlen, 0 = aus. */
	statsInterval: number
	webhookEnabled: boolean
	debugLogging: boolean
}

export type ModuleSecrets = {
	apiKey: string
	webhookSecret: string
}

export const DEFAULT_POLL_INTERVAL = 30
export const WEBHOOK_POLL_INTERVAL = 120
export const MIN_POLL_INTERVAL = 15
export const DEFAULT_STATS_INTERVAL = 120

export interface ConfigContext {
	events: ApiEvent[]
	channels: LiveVoiceChannel[]
	/** Pfad des Companion-HTTP-Handlers dieser Instanz, z.B. /instance/livevoice/webhook */
	webhookPath: string
}

function eventField(events: ApiEvent[]): SomeCompanionConfigField {
	const visible = events.filter((event) => event.state !== 'stale')
	if (visible.length === 0) {
		return {
			type: 'textinput',
			id: 'eventId',
			label: 'Event',
			tooltip:
				'"auto" nimmt das einzige aktive Event des Kontos. Nach der ersten erfolgreichen Verbindung erscheint hier ein Dropdown mit allen Events.',
			width: 6,
			default: 'auto',
		}
	}
	const choices: DropdownChoice[] = [
		{ id: 'auto', label: 'Auto (einziges aktives Event)' },
		...visible
			.slice()
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((event) => ({
				id: String(event.id),
				label: `${event.name} (${event.id}${event.state === 'inactive' ? ', inaktiv' : ''})`,
			})),
	]
	return { type: 'dropdown', id: 'eventId', label: 'Event', width: 6, choices, default: 'auto' }
}

function preferredChannelField(channels: LiveVoiceChannel[]): SomeCompanionConfigField {
	if (channels.length === 0) {
		return {
			type: 'textinput',
			id: 'preferredChannelId',
			label: 'Bevorzugter Import-Channel',
			tooltip:
				'"auto" wählt den Channel mit Audio-Eingang (Quellkanal). Nach der ersten erfolgreichen Verbindung erscheint hier ein Dropdown.',
			width: 6,
			default: 'auto',
		}
	}
	return {
		type: 'dropdown',
		id: 'preferredChannelId',
		label: 'Bevorzugter Import-Channel',
		tooltip: 'Standard-Channel für Actions/Feedbacks mit Channel-Option "Auto / Quellkanal".',
		width: 6,
		choices: [
			{ id: 'auto', label: 'Auto / Quellkanal' },
			...channels.map((channel) => ({ id: String(channel.id), label: `${channel.name} (${channel.id})` })),
		],
		default: 'auto',
	}
}

export function GetConfigFields(context: ConfigContext): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'LiveVoice Server API',
			width: 12,
			value:
				'Nutzt die offizielle LiveVoice Server API v2 (Plan PLUS, Freischaltung durch den LiveVoice-Support). ' +
				'API-Keys werden im LiveVoice-Konto unter <i>API</i> erstellt. Limit: 60 Requests/Minute und ' +
				'<b>300 Requests/Stunde pro IP-Adresse</b> - das Modul teilt sein Budget selbst ein und hält Reserve für Button-Aktionen frei.',
		},
		{
			type: 'secret-text',
			id: 'apiKey',
			label: 'API-Key',
			tooltip: 'Server-API-Key des LiveVoice-Kontos. Wird nur lokal in Companion gespeichert und nie geloggt.',
			width: 12,
		},
		eventField(context.events),
		preferredChannelField(context.channels),
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Status-Abfrage alle … Sekunden',
			tooltip:
				`Wie oft der Channel-Status abgefragt wird (1 Request pro Abfrage). Minimum ${MIN_POLL_INTERVAL} s. ` +
				`30 s = 120 Requests/Stunde. Mit aktivem Webhook wird automatisch nur alle ${WEBHOOK_POLL_INTERVAL} s abgeglichen.`,
			width: 6,
			min: MIN_POLL_INTERVAL,
			max: 3600,
			default: DEFAULT_POLL_INTERVAL,
		},
		{
			type: 'number',
			id: 'statsInterval',
			label: 'Teilnehmerzahl alle … Sekunden (0 = aus)',
			tooltip:
				'Fragt die aktuelle Teilnehmerzahl von Event und Import-Channel ab (2 Requests pro Abfrage). ' +
				'120 s = 60 Requests/Stunde.',
			width: 6,
			min: 0,
			max: 3600,
			default: DEFAULT_STATS_INTERVAL,
		},
		{
			type: 'checkbox',
			id: 'webhookEnabled',
			label: 'Webhook empfangen (optional)',
			tooltip:
				'Nur sinnvoll, wenn Companion aus dem Internet per HTTPS erreichbar ist (z.B. Reverse-Proxy/Tunnel). ' +
				'Dann meldet LiveVoice Statuswechsel sofort, und das Polling läuft nur noch als Abgleich.',
			width: 6,
			default: false,
		},
		{
			type: 'secret-text',
			id: 'webhookSecret',
			label: 'Webhook-Secret',
			tooltip: 'Dasselbe zufällige Secret (32-255 Zeichen), das beim Webhook in LiveVoice hinterlegt ist.',
			width: 6,
			isVisibleExpression: '$(options:webhookEnabled)',
		},
		{
			type: 'static-text',
			id: 'webhookInfo',
			label: 'Webhook-URL',
			width: 12,
			value:
				`Webhook-Endpunkt dieser Verbindung: <code>https://&lt;öffentliche-Companion-Adresse&gt;${context.webhookPath}</code> ` +
				'(Event <code>channel_state_changed</code>). Den Webhook legst du einmalig per API an, siehe Hilfe.',
			isVisibleExpression: '$(options:webhookEnabled)',
		},
		{
			type: 'checkbox',
			id: 'debugLogging',
			label: 'Debug-Logging',
			tooltip: 'Protokolliert Statuswechsel, Webhooks und Request-Budget auf Debug-Level.',
			width: 6,
			default: false,
		},
	]
}
