import { describe, expect, it } from 'vitest'
import { mapImportState, parseApiState, selectDefaultImportChannel, toChannel } from '../state.js'
import type { LiveVoiceChannel } from '../types.js'

function channel(partial: Partial<LiveVoiceChannel> & { id: number; name: string }): LiveVoiceChannel {
	return { importState: 'unknown', hasAudioInput: false, hasAiTranslation: false, ...partial }
}

describe('mapImportState', () => {
	it('maps API states to the simplified import state', () => {
		expect(mapImportState('importing_source')).toBe('active')
		expect(mapImportState('importing_channel')).toBe('active')
		expect(mapImportState('speaking')).toBe('inactive')
		expect(mapImportState('ai_translating')).toBe('inactive')
		expect(mapImportState('offline')).toBe('offline')
		expect(mapImportState(undefined)).toBe('unknown')
	})

	it('rejects unknown raw states', () => {
		expect(parseApiState('something_new')).toBeUndefined()
		expect(parseApiState(42)).toBeUndefined()
		expect(parseApiState('speaking')).toBe('speaking')
	})
})

describe('toChannel', () => {
	it('reads features and keeps the previous listener count', () => {
		const result = toChannel(
			{
				id: 7,
				event_id: 1,
				name: 'Deutsch',
				state: 'ai_translating',
				ai_translation: { enabled: true, source_channel_id: 3 },
			},
			channel({ id: 7, name: 'Deutsch', listeners: 12 }),
		)
		expect(result).toMatchObject({
			id: 7,
			state: 'ai_translating',
			importState: 'inactive',
			hasAiTranslation: true,
			hasAudioInput: false,
			aiSourceChannelId: 3,
			listeners: 12,
		})
	})
})

describe('selectDefaultImportChannel', () => {
	it('picks the only audio channel without AI', () => {
		const result = selectDefaultImportChannel([
			channel({ id: 1, name: 'Original', hasAudioInput: true }),
			channel({ id: 2, name: 'English', hasAiTranslation: true, aiSourceChannelId: 1 }),
		])
		expect(result?.id).toBe(1)
	})

	it('prefers the channel used as AI source when several have audio input', () => {
		const result = selectDefaultImportChannel([
			channel({ id: 1, name: 'Bühne', hasAudioInput: true }),
			channel({ id: 4, name: 'Saal 2', hasAudioInput: true }),
			channel({ id: 2, name: 'English', hasAiTranslation: true, aiSourceChannelId: 4 }),
		])
		expect(result?.id).toBe(4)
	})

	it('handles import channels without audio input (real event layout)', () => {
		const result = selectDefaultImportChannel([
			channel({ id: 125145, name: 'Original Audio' }),
			channel({ id: 9, name: 'Moderation' }),
			channel({ id: 125147, name: 'English', hasAiTranslation: true, aiSourceChannelId: 125145 }),
		])
		expect(result?.id).toBe(125145)
	})

	it('falls back to "Original Audio" by name and otherwise returns nothing', () => {
		expect(
			selectDefaultImportChannel([
				channel({ id: 1, name: 'A', hasAudioInput: true }),
				channel({ id: 2, name: 'Original Audio', hasAudioInput: true }),
			])?.id,
		).toBe(2)
		expect(
			selectDefaultImportChannel([
				channel({ id: 1, name: 'A', hasAudioInput: true }),
				channel({ id: 2, name: 'B', hasAudioInput: true }),
			]),
		).toBeUndefined()
	})
})
