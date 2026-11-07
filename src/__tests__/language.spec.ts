import { describe, expect, it } from 'vitest'
import { currentVoice, planSourceLanguageChange, planVoiceChange, targetMatchesLanguage } from '../state.js'
import type { LiveVoiceChannel } from '../types.js'

function channel(partial: Partial<LiveVoiceChannel> & { id: number; name: string }): LiveVoiceChannel {
	return {
		importState: 'offline',
		hasAudioInput: false,
		hasAiTranslation: false,
		spokenLanguages: [],
		hasLiveCaptions: false,
		hidden: false,
		...partial,
	}
}

function ai(id: number, name: string, target: string, extra: Partial<LiveVoiceChannel> = {}): LiveVoiceChannel {
	return channel({
		id,
		name,
		hasAiTranslation: true,
		aiSourceChannelId: 1,
		aiLanguages: ['de'],
		aiTargetLanguage: target,
		...extra,
	})
}

/** Abbild von Event 64447 (Stand 07.11.2026). */
const EVENT = [
	channel({ id: 1, name: 'Original Audio', spokenLanguages: ['de'] }),
	ai(2, 'English', 'en-US'),
	ai(3, 'Français', 'fr-FR'),
	ai(4, 'Українська', 'uk-UA'),
	ai(9, 'Anderer Saal', 'en-US', { aiSourceChannelId: 99 }),
]

describe('targetMatchesLanguage', () => {
	it('compares the language part, or exactly for regional source languages', () => {
		expect(targetMatchesLanguage('en-US', 'en')).toBe(true)
		expect(targetMatchesLanguage('fil-PH', 'fil')).toBe(true)
		expect(targetMatchesLanguage('de-DE', 'en')).toBe(false)
		expect(targetMatchesLanguage('pt-BR', 'pt-BR')).toBe(true)
		expect(targetMatchesLanguage('pt-PT', 'pt-BR')).toBe(false)
		expect(targetMatchesLanguage(undefined, 'de')).toBe(false)
	})
})

describe('planSourceLanguageChange', () => {
	it('switches to English: source + all its AI channels, hides the English channel', () => {
		const plans = planSourceLanguageChange(EVENT, 1, 'en', true)
		expect(plans.map((p) => p.channelId)).toEqual([1, 2, 3, 4])
		expect(plans[0].patch).toEqual({
			spoken_languages: ['en'],
			ai_live_captions: { enabled: false, languages: ['en'] },
		})
		expect(plans[1].patch).toEqual({
			ai_translation: { enabled: true, languages: ['en'] },
			hiding: { enabled: true, hidden_on_app: true, hidden_on_web: true, hidden_on_iframe: true },
		})
		expect(plans[2].patch).toEqual({ ai_translation: { enabled: true, languages: ['en'] } })
	})

	it('switching back unhides and skips channels that already fit', () => {
		const afterEnglish = [
			channel({ id: 1, name: 'Original Audio', spokenLanguages: ['en'] }),
			ai(2, 'English', 'en-US', { aiLanguages: ['en'], hidden: true }),
			ai(3, 'Français', 'fr-FR', { aiLanguages: ['de'] }),
		]
		const plans = planSourceLanguageChange(afterEnglish, 1, 'de', true)
		expect(plans.find((p) => p.channelId === 2)?.patch).toEqual({
			ai_translation: { enabled: true, languages: ['de'] },
			hiding: { enabled: false },
		})
		expect(plans.some((p) => p.channelId === 3)).toBe(false)
	})

	it('keeps channels hidden that were hidden for other reasons', () => {
		const manual = [
			channel({ id: 1, name: 'Original Audio', spokenLanguages: ['en'] }),
			ai(4, 'Українська', 'uk-UA', { aiLanguages: ['en'], hidden: true }),
		]
		const plans = planSourceLanguageChange(manual, 1, 'de', true)
		expect(plans.find((p) => p.channelId === 4)?.patch).toEqual({
			ai_translation: { enabled: true, languages: ['de'] },
		})
	})

	it('leaves hiding untouched when disabled and updates live captions', () => {
		const withCaptions = [
			channel({ id: 1, name: 'O', spokenLanguages: ['de'], hasLiveCaptions: true }),
			ai(2, 'E', 'en-US'),
		]
		const plans = planSourceLanguageChange(withCaptions, 1, 'en', false)
		expect(plans[0].patch).toEqual({
			spoken_languages: ['en'],
			ai_live_captions: { enabled: true, languages: ['en'] },
		})
		expect(plans[1].patch).toEqual({ ai_translation: { enabled: true, languages: ['en'] } })
	})

	it('does nothing when everything already matches', () => {
		expect(planSourceLanguageChange(EVENT, 1, 'de', true)).toEqual([])
	})
})

describe('planVoiceChange / currentVoice', () => {
	const channels = [
		channel({ id: 1, name: 'Original Audio' }),
		ai(2, 'English', 'en-US', { aiVoice: 'male' }),
		ai(3, 'Français', 'fr-FR', { aiVoice: 'female' }),
		ai(4, 'Untertitel', 'it-IT', { aiVoice: undefined }),
	]

	it('changes only AI channels with speech output whose voice differs', () => {
		const plans = planVoiceChange(channels, 'female')
		expect(plans.map((p) => p.channelId)).toEqual([2])
		expect(plans[0].patch).toEqual({ ai_translation: { enabled: true, voice: 'female' } })
	})

	it('reports the common voice, "gemischt" or empty', () => {
		expect(currentVoice(channels)).toBe('gemischt')
		expect(currentVoice(channels.filter((c) => c.id !== 3))).toBe('male')
		expect(currentVoice([channels[0]])).toBe('')
	})
})
