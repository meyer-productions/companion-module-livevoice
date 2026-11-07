import type { CompanionInputFieldDropdown } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { languageChoices } from './languages.js'

type ChannelOptions = { options: { channelId: string } }

export type ActionsSchema = {
	startImport: ChannelOptions
	stopImport: ChannelOptions
	toggleImport: ChannelOptions
	startAi: ChannelOptions
	stopAi: ChannelOptions
	toggleAi: ChannelOptions
	refresh: { options: Record<string, never> }
	setSourceLanguage: { options: { channelId: string; language: string; manageHiding: boolean } }
}

function importChannelField(self: ModuleInstance): CompanionInputFieldDropdown<'channelId', string | number> {
	return {
		type: 'dropdown',
		id: 'channelId',
		label: 'Channel',
		choices: self.getChannelActionChoices(),
		default: 'auto',
	}
}

function aiChannelField(self: ModuleInstance): CompanionInputFieldDropdown<'channelId', string | number> {
	const choices = self.getAiChannelChoices()
	return {
		type: 'dropdown',
		id: 'channelId',
		label: 'AI-Channel',
		choices,
		default: choices[0]?.id ?? '',
	}
}

export function UpdateActions(self: ModuleInstance): void {
	const run =
		(label: string, handler: (channelId: number) => Promise<void>, ai = false) =>
		async (action: { options: { channelId?: unknown } }): Promise<void> => {
			const option = action.options.channelId
			const raw = typeof option === 'string' || typeof option === 'number' ? String(option) : ai ? '' : 'auto'
			const channelId = ai ? self.resolveAiChannelId(raw) : self.resolveChannelId(raw)
			if (channelId === undefined) {
				self.log('warn', `${label}: kein gültiger Channel ermittelbar`)
				return
			}
			try {
				await handler(channelId)
			} catch (error) {
				self.log('warn', `${label} (Channel ${channelId}) fehlgeschlagen: ${(error as Error).message}`)
			}
		}

	self.setActionDefinitions({
		startImport: {
			name: 'Import starten',
			description: 'Startet den Audio-Import für den gewählten Channel',
			options: [importChannelField(self)],
			callback: run('Import starten', async (id) => self.client.command(id, 'start-import')),
		},
		stopImport: {
			name: 'Import stoppen',
			description: 'Stoppt den Audio-Import für den gewählten Channel',
			options: [importChannelField(self)],
			callback: run('Import stoppen', async (id) => self.client.command(id, 'stop-import')),
		},
		toggleImport: {
			name: 'Import umschalten',
			description:
				'Schaltet den Import um, basierend auf dem tatsächlichen LiveVoice-Serverstatus - nicht auf dem zuletzt ' +
				'gesendeten Befehl. Bei unbekanntem Status wird die Aktion abgelehnt statt blind umzuschalten.',
			options: [importChannelField(self)],
			callback: run('Import umschalten', async (id) => self.toggleImport(id)),
		},
		startAi: {
			name: 'AI-Übersetzung starten',
			description: 'Startet die AI-Übersetzung eines AI-Channels (Start/Stop-Modus "manuell")',
			options: [aiChannelField(self)],
			callback: run('AI starten', async (id) => self.client.command(id, 'start-ai'), true),
		},
		stopAi: {
			name: 'AI-Übersetzung stoppen',
			description: 'Stoppt die AI-Übersetzung eines AI-Channels',
			options: [aiChannelField(self)],
			callback: run('AI stoppen', async (id) => self.client.command(id, 'stop-ai'), true),
		},
		toggleAi: {
			name: 'AI-Übersetzung umschalten',
			description: 'Schaltet die AI-Übersetzung anhand des tatsächlichen Serverstatus um (ai_translating)',
			options: [aiChannelField(self)],
			callback: run('AI umschalten', async (id) => self.toggleAi(id), true),
		},
		setSourceLanguage: {
			name: 'Ursprungssprache setzen',
			description:
				'Setzt die gesprochene Sprache des Quell-Channels und die Quellsprache aller AI-Channels, die daraus ' +
				'übersetzen. Der AI-Channel mit derselben Zielsprache wird ausgeblendet (O-Ton reicht), der wegen der ' +
				'bisherigen Ursprungssprache ausgeblendete wieder eingeblendet. Verbraucht 1 Request plus 1 pro geändertem Channel.',
			options: [
				importChannelField(self),
				{ type: 'dropdown', id: 'language', label: 'Sprache', choices: languageChoices(), default: 'de' },
				{
					type: 'checkbox',
					id: 'manageHiding',
					label: 'AI-Channel in Ursprungssprache ausblenden',
					default: true,
				},
			],
			callback: async (action) => {
				const raw = action.options.channelId
				const channelId = self.resolveChannelId(
					typeof raw === 'string' || typeof raw === 'number' ? String(raw) : 'auto',
				)
				const language = String(action.options.language ?? '')
				if (channelId === undefined) {
					self.log('warn', 'Ursprungssprache setzen: kein gültiger Quell-Channel ermittelbar')
					return
				}
				await self.setSourceLanguage(channelId, language, action.options.manageHiding !== false)
			},
		},
		refresh: {
			name: 'Status jetzt abfragen',
			description: 'Lädt den Status aller Channels sofort neu (verbraucht 1 Request)',
			options: [],
			callback: async () => self.client.refreshNow(),
		},
	})
}
