import {
	API_CHANNEL_STATES,
	type ApiChannel,
	type ApiChannelPatch,
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
		spokenLanguages: raw.spoken_languages ?? [],
		aiLanguages: raw.ai_translation?.enabled ? (raw.ai_translation.languages ?? []) : undefined,
		aiTargetLanguage: raw.ai_translation?.enabled ? raw.ai_translation.target_language : undefined,
		hasLiveCaptions: raw.ai_live_captions?.enabled === true,
		hidden: raw.hiding?.enabled === true,
		listeners: previous?.listeners,
	}
}

/**
 * Entspricht die AI-Zielsprache (z.B. "en-US") der gesprochenen Sprache (z.B. "en")? Sprachen mit Region in
 * der Quell-Liste (pt-BR, zh-CN …) müssen exakt passen, sonst zählt der Sprachteil vor dem Bindestrich.
 */
export function targetMatchesLanguage(target: string | undefined, language: string): boolean {
	if (!target) return false
	const t = target.toLowerCase()
	const l = language.toLowerCase()
	if (l.includes('-')) return t === l
	return t.split('-')[0] === l
}

export interface LanguageChangePlan {
	channelId: number
	channelName: string
	patch: ApiChannelPatch
	/** Kurzbeschreibung für das Log. */
	summary: string
}

/**
 * Plant die Umstellung der Ursprungssprache: Quell-Channel bekommt die neue Sprache (inkl. AI-Untertitel),
 * jeder AI-Channel mit diesem Quell-Channel übersetzt künftig aus der neuen Sprache. AI-Channels, deren
 * Zielsprache gleich der neuen Ursprungssprache ist, werden (optional) ausgeblendet - im O-Ton ist die Sprache
 * ja schon vorhanden; der wegen der bisherigen Ursprungssprache ausgeblendete Channel wird wieder eingeblendet. Channels, die schon passen, werden ausgelassen
 * (spart Requests).
 */
export function planSourceLanguageChange(
	channels: LiveVoiceChannel[],
	sourceId: number,
	language: string,
	manageHiding: boolean,
): LanguageChangePlan[] {
	const plans: LanguageChangePlan[] = []
	const source = channels.find((channel) => channel.id === sourceId)
	if (!source) return plans

	// Nur Channels wieder einblenden, die wegen der bisherigen Ursprungssprache ausgeblendet waren - absichtlich
	// anders ausgeblendete Channels bleiben, wie sie sind.
	const previousLanguage = source.spokenLanguages.length === 1 ? source.spokenLanguages[0] : undefined
	const sourcePatch: ApiChannelPatch = {}
	if (source.spokenLanguages.length !== 1 || source.spokenLanguages[0] !== language) {
		sourcePatch.spoken_languages = [language]
		// LiveVoice validiert die gespeicherten Untertitel-Sprachen auch bei ausgeschalteten Untertiteln gegen
		// spoken_languages (sonst 422 invalid_params) - deshalb immer mitsetzen, Ein/Aus-Zustand beibehalten.
		sourcePatch.ai_live_captions = { enabled: source.hasLiveCaptions, languages: [language] }
	}
	if (Object.keys(sourcePatch).length > 0) {
		plans.push({ channelId: source.id, channelName: source.name, patch: sourcePatch, summary: `Sprache ${language}` })
	}

	for (const channel of channels) {
		if (!channel.hasAiTranslation || channel.aiSourceChannelId !== sourceId) continue
		const patch: ApiChannelPatch = {}
		const notes: string[] = []
		if (channel.aiLanguages?.length !== 1 || channel.aiLanguages[0] !== language) {
			patch.ai_translation = { enabled: true, languages: [language] }
			notes.push(`übersetzt aus ${language}`)
		}
		if (manageHiding) {
			const shouldHide = targetMatchesLanguage(channel.aiTargetLanguage, language)
			if (shouldHide && !channel.hidden) {
				patch.hiding = { enabled: true, hidden_on_app: true, hidden_on_web: true, hidden_on_iframe: true }
				notes.push('ausgeblendet')
			} else if (
				!shouldHide &&
				channel.hidden &&
				previousLanguage !== undefined &&
				targetMatchesLanguage(channel.aiTargetLanguage, previousLanguage)
			) {
				patch.hiding = { enabled: false }
				notes.push('eingeblendet')
			}
		}
		if (notes.length > 0) {
			plans.push({ channelId: channel.id, channelName: channel.name, patch, summary: notes.join(', ') })
		}
	}
	return plans
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
