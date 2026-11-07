/** Channel-Zustand laut LiveVoice Server API v2 (`Channel.state`). */
export type ApiChannelState = 'offline' | 'speaking' | 'importing_source' | 'importing_channel' | 'ai_translating'

export const API_CHANNEL_STATES: readonly ApiChannelState[] = [
	'offline',
	'speaking',
	'importing_source',
	'importing_channel',
	'ai_translating',
]

/**
 * Vereinfachter Import-Zustand für Buttons/Feedbacks (kompatibel zu 0.3.x):
 * - `active`   Channel importiert gerade Audio (importing_source / importing_channel)
 * - `inactive` Channel ist live, aber nicht per Import (speaking / ai_translating)
 * - `offline`  Channel sendet nichts
 * - `unknown`  Zustand (noch) nicht bekannt, z.B. vor dem ersten Abruf oder nach Fehlern
 */
export type ImportState = 'active' | 'inactive' | 'offline' | 'unknown'

/** Rohdaten eines Channels aus der API (nur die Felder, die das Modul nutzt). */
export interface ApiChannel {
	id: number
	event_id: number
	state?: string
	code?: string | null
	name: string
	spoken_languages?: string[]
	audio_input?: { enabled: boolean }
	ai_translation?: { enabled: boolean; source_channel_id?: number; target_language?: string }
	ai_live_captions?: { enabled: boolean }
	speaker_url?: string | null
}

/** Rohdaten eines Events aus der API (nur die Felder, die das Modul nutzt). */
export interface ApiEvent {
	id: number
	name: string
	state?: string
	code?: string
	participant_url?: string
	operator_url?: string
}

export interface LiveVoiceChannel {
	id: number
	name: string
	/** Roher API-Zustand, `undefined` solange unbekannt. */
	state?: ApiChannelState
	importState: ImportState
	hasAudioInput: boolean
	hasAiTranslation: boolean
	aiSourceChannelId?: number
	/** Aktuelle Teilnehmende (Statistik-Endpunkt), `undefined` solange nicht abgefragt. */
	listeners?: number
}

export interface LiveVoiceEventState {
	eventId?: number
	name?: string
	joinCode?: string
	participantUrl?: string
	/** Aktuelle Teilnehmende des ganzen Events (Statistik-Endpunkt). */
	listeners?: number
	channels: Map<number, LiveVoiceChannel>
}
