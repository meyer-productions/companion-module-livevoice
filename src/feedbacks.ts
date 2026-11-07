import type { CompanionInputFieldDropdown } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { API_CHANNEL_STATES, type ImportState } from './types.js'

export type FeedbacksSchema = {
	importActive: { type: 'boolean'; options: { channelId: string } }
	importInactive: { type: 'boolean'; options: { channelId: string } }
	importOffline: { type: 'boolean'; options: { channelId: string } }
	importUnknown: { type: 'boolean'; options: { channelId: string } }
	aiActive: { type: 'boolean'; options: { channelId: string } }
	channelState: { type: 'boolean'; options: { channelId: string; state: string } }
	connected: { type: 'boolean'; options: Record<string, never> }
	listenerCountCompare: { type: 'boolean'; options: { channelId: string; comparator: string; value: number } }
}

function channelField(self: ModuleInstance): CompanionInputFieldDropdown<'channelId', string | number> {
	return {
		type: 'dropdown',
		id: 'channelId',
		label: 'Channel',
		choices: self.getChannelActionChoices(),
		default: 'auto',
	}
}

/** Liefert 'unknown', wenn der Channel gar nicht auflösbar ist - so wie bei einem unbekannten Server-State. */
function currentImportState(self: ModuleInstance, channelIdOption: unknown): ImportState {
	const channelId = self.resolveChannelId(typeof channelIdOption === 'string' ? channelIdOption : 'auto')
	if (channelId === undefined) return 'unknown'
	return self.client.getChannel(channelId)?.importState ?? 'unknown'
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	const aiChoices = self.getAiChannelChoices()

	self.setFeedbackDefinitions({
		importActive: {
			type: 'boolean',
			name: 'Import ist aktiv',
			description: 'Aktiv, wenn der gewählte Channel laut LiveVoice gerade Audio importiert',
			defaultStyle: { bgcolor: 0x00cc00, color: 0xffffff },
			options: [channelField(self)],
			callback: (feedback) => currentImportState(self, feedback.options.channelId) === 'active',
		},
		importInactive: {
			type: 'boolean',
			name: 'Import ist inaktiv',
			description: 'Aktiv, wenn der gewählte Channel eindeutig nicht importiert (offline, Sprecher oder AI)',
			defaultStyle: { bgcolor: 0xc80000, color: 0xffffff },
			options: [channelField(self)],
			callback: (feedback) => {
				const state = currentImportState(self, feedback.options.channelId)
				return state === 'inactive' || state === 'offline'
			},
		},
		importOffline: {
			type: 'boolean',
			name: 'Channel ist offline',
			description: 'Aktiv, wenn der gewählte Channel laut LiveVoice "offline" ist (sendet nichts)',
			defaultStyle: { bgcolor: 0x626d75, color: 0xffffff },
			options: [channelField(self)],
			callback: (feedback) => currentImportState(self, feedback.options.channelId) === 'offline',
		},
		importUnknown: {
			type: 'boolean',
			name: 'Import-Status unbekannt',
			description: 'Aktiv, wenn der Status des gewählten Channels (noch) nicht bekannt ist, z.B. bei API-Fehlern',
			defaultStyle: { bgcolor: 0x626d75, color: 0xffffff },
			options: [channelField(self)],
			callback: (feedback) => currentImportState(self, feedback.options.channelId) === 'unknown',
		},
		aiActive: {
			type: 'boolean',
			name: 'AI-Übersetzung läuft',
			description: 'Aktiv, wenn der gewählte AI-Channel den Zustand "ai_translating" hat',
			defaultStyle: { bgcolor: 0x00cc00, color: 0xffffff },
			options: [
				{
					type: 'dropdown',
					id: 'channelId',
					label: 'AI-Channel',
					choices: aiChoices,
					default: aiChoices[0]?.id ?? '',
				},
			],
			callback: (feedback) => {
				const channelId = self.resolveAiChannelId(String(feedback.options.channelId ?? ''))
				return channelId !== undefined && self.client.getChannel(channelId)?.state === 'ai_translating'
			},
		},
		channelState: {
			type: 'boolean',
			name: 'Channel-Zustand ist …',
			description: 'Vergleicht den rohen LiveVoice-Zustand eines Channels mit einem Wert',
			defaultStyle: { bgcolor: 0x0064c8, color: 0xffffff },
			options: [
				channelField(self),
				{
					type: 'dropdown',
					id: 'state',
					label: 'Zustand',
					choices: API_CHANNEL_STATES.map((state) => ({ id: state, label: state })),
					default: 'importing_source',
				},
			],
			callback: (feedback) => {
				const channelId = self.resolveChannelId(String(feedback.options.channelId ?? 'auto'))
				return channelId !== undefined && self.client.getChannel(channelId)?.state === feedback.options.state
			},
		},
		connected: {
			type: 'boolean',
			name: 'LiveVoice verbunden',
			description: 'Aktiv, solange die letzte Abfrage der LiveVoice-API erfolgreich war',
			defaultStyle: { bgcolor: 0x00c800, color: 0xffffff },
			options: [],
			callback: () => self.client.isConnected(),
		},
		listenerCountCompare: {
			type: 'boolean',
			name: 'Teilnehmerzahl vergleichen',
			description:
				'Vergleicht die aktuelle Teilnehmerzahl des gewählten Channels mit einem festen Wert ' +
				'(benötigt aktivierte Teilnehmerzahl-Abfrage)',
			defaultStyle: { bgcolor: 0x00c800, color: 0xffffff },
			options: [
				channelField(self),
				{
					type: 'dropdown',
					id: 'comparator',
					label: 'Vergleich',
					choices: [
						{ id: 'eq', label: '=' },
						{ id: 'gt', label: '>' },
						{ id: 'lt', label: '<' },
						{ id: 'gte', label: '>=' },
						{ id: 'lte', label: '<=' },
					],
					default: 'gt',
				},
				{ type: 'number', id: 'value', label: 'Wert', min: 0, max: 100_000, default: 0 },
			],
			callback: (feedback) => {
				const channelId = self.resolveChannelId(String(feedback.options.channelId ?? 'auto'))
				if (channelId === undefined) return false
				const listeners = self.client.getChannel(channelId)?.listeners ?? 0
				const value = Number(feedback.options.value ?? 0)
				switch (feedback.options.comparator) {
					case 'eq':
						return listeners === value
					case 'gt':
						return listeners > value
					case 'lt':
						return listeners < value
					case 'gte':
						return listeners >= value
					case 'lte':
						return listeners <= value
					default:
						return false
				}
			},
		},
	})
}
