import type { CompanionVariableDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'

export type VariablesSchema = {
	connection_status: string
	event_name: string
	event_id: string
	join_code: string
	participant_url: string
	event_listener_count: number
	import_channel_name: string
	import_channel_id: string
	import_state: string
	import_action: string
	import_status: string
	channel_state: string
	source_language: string
	ai_voice: string
	listener_count: number
	api_requests_last_hour: number
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: CompanionVariableDefinitions<VariablesSchema> = {
		connection_status: { name: 'Verbindungsstatus (ok/connecting/disconnected/error)' },
		event_name: { name: 'Event-Name' },
		event_id: { name: 'Event-ID' },
		join_code: { name: 'Join-Code' },
		participant_url: { name: 'Teilnehmer-Link' },
		event_listener_count: { name: 'Teilnehmende Event (aktuell)' },
		import_channel_name: { name: 'Import-Channel: Name' },
		import_channel_id: { name: 'Import-Channel: ID' },
		import_state: { name: 'Import-Status (active/inactive/offline/unknown)' },
		import_action: { name: 'Import: nächste Aktion (Import starten/Import stoppen)' },
		import_status: { name: 'Import: Statustext (LÄUFT/INAKTIV/OFFLINE/UNBEKANNT)' },
		channel_state: { name: 'Import-Channel: LiveVoice-Zustand (roh)' },
		source_language: { name: 'Ursprungssprache des Import-Channels (z.B. de)' },
		ai_voice: { name: 'Stimme der AI-Channels (male/female/…/gemischt)' },
		listener_count: { name: 'Teilnehmende Import-Channel (aktuell)' },
		api_requests_last_hour: { name: 'API-Requests der letzten Stunde (Limit 300)' },
	}

	self.setVariableDefinitions(definitions)
}
