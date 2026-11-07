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

/** Stimmen der AI-Sprachausgabe laut API; Premium-Stimmen werden von LiveVoice separat verrechnet. */
export type AiVoice = 'male' | 'female' | 'male_premium' | 'female_premium'

export const AI_VOICES: readonly AiVoice[] = ['male', 'female', 'male_premium', 'female_premium']

export const VOICE_CHOICES: { id: AiVoice; label: string }[] = [
	{ id: 'male', label: 'Männlich' },
	{ id: 'female', label: 'Weiblich' },
	{ id: 'male_premium', label: 'Männlich Premium (separat verrechnet)' },
	{ id: 'female_premium', label: 'Weiblich Premium (separat verrechnet)' },
]

/** Rohdaten eines Channels aus der API (nur die Felder, die das Modul nutzt). */
export interface ApiChannel {
	id: number
	event_id: number
	state?: string
	code?: string | null
	name: string
	spoken_languages?: string[]
	audio_input?: { enabled: boolean }
	ai_translation?: {
		enabled: boolean
		source_channel_id?: number
		languages?: string[]
		target_language?: string
		voice?: string | null
		speaker_enabled?: boolean
	}
	ai_live_captions?: { enabled: boolean; languages?: string[] }
	hiding?: { enabled: boolean; hidden_on_app?: boolean; hidden_on_web?: boolean; hidden_on_iframe?: boolean }
	speaker_url?: string | null
}

/** Teil-Update eines Channels (PATCH /channels/{id}); nur gesendete Felder werden geändert. */
export type ApiChannelPatch = {
	spoken_languages?: string[]
	ai_translation?: { enabled: true; languages?: string[]; voice?: AiVoice }
	ai_live_captions?: { enabled: boolean; languages: string[] }
	hiding?: { enabled: boolean; hidden_on_app?: boolean; hidden_on_web?: boolean; hidden_on_iframe?: boolean }
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
	/** Gesprochene Sprachen (Quell-Channels), z.B. ["de"]. */
	spokenLanguages: string[]
	/** AI-Channels: übersetzte Sprachen des Quell-Channels. */
	aiLanguages?: string[]
	/** AI-Channels: Zielsprache, z.B. "en-US". */
	aiTargetLanguage?: string
	/** AI-Channels: Stimme der Sprachausgabe, `undefined` ohne Sprachausgabe (nur übersetzte Untertitel). */
	aiVoice?: string
	/** AI-Untertitel aktiv (deren Sprachen folgen der Ursprungssprache). */
	hasLiveCaptions: boolean
	/** Für Teilnehmende ausgeblendet (Feature "hiding" aktiv). */
	hidden: boolean
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
