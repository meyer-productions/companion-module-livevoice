import {
	API_CHANNEL_STATES,
	type ApiChannel,
	type ApiChannelState,
	type ImportState,
	type LiveVoiceChannel,
} from './types.js'

export function parseApiState(value: unknown): ApiChannelState | undefined {
	return typeof value === 'string' && (API_CHANNEL_STATES as readonly string[]).includes(value)
		? (value as ApiChannelState)
		: undefined
}

/** Bildet den API-Zustand auf den vereinfachten Import-Zustand ab (siehe {@link ImportState}). */
export function mapImportState(state: ApiChannelState | undefined): ImportState {
	switch (state) {
		case 'importing_source':
		case 'importing_channel':
			return 'active'
		case 'speaking':
		case 'ai_translating':
			return 'inactive'
		case 'offline':
			return 'offline'
		default:
			return 'unknown'
	}
}

export function toChannel(raw: ApiChannel, previous?: LiveVoiceChannel): LiveVoiceChannel {
	const state = parseApiState(raw.state)
	return {
		id: raw.id,
		name: raw.name,
		state,
		importState: mapImportState(state),
		hasAudioInput: raw.audio_input?.enabled === true,
		hasAiTranslation: raw.ai_translation?.enabled === true,
		aiSourceChannelId: raw.ai_translation?.enabled ? raw.ai_translation.source_channel_id : undefined,
		listeners: previous?.listeners,
	}
}

/**
 * Wählt den Standard-Import-Channel für die Option "Auto / Quellkanal":
 * Channels ohne eigene AI-Übersetzung (bevorzugt solche mit Audio-Eingang). Ist das genau einer, wird er genommen; bei mehreren
 * gewinnt einer, der von AI-Channels als Quelle verwendet wird, danach einer mit Namen "Original Audio".
 * Ist die Wahl nicht eindeutig, gibt es bewusst kein Ergebnis (lieber nichts tun als den falschen Channel).
 */
export function selectDefaultImportChannel(channels: LiveVoiceChannel[]): LiveVoiceChannel | undefined {
	const nonAi = channels.filter((channel) => !channel.hasAiTranslation)
	// Import-Channels haben oft keinen Audio-Eingang (Feature import_audio statt audio_input) - dann zählen alle
	// Nicht-AI-Channels als Kandidaten.
	const withAudio = nonAi.filter((channel) => channel.hasAudioInput)
	const pool = withAudio.length > 0 ? withAudio : nonAi
	if (pool.length <= 1) return pool[0]

	const sourceIds = new Set(
		channels.map((channel) => channel.aiSourceChannelId).filter((id): id is number => id !== undefined),
	)
	const usedAsSource = pool.filter((channel) => sourceIds.has(channel.id))
	if (usedAsSource.length === 1) return usedAsSource[0]

	return pool.find((channel) => channel.name.trim().toLowerCase() === 'original audio')
}
