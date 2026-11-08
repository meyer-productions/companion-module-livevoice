import type {
	CompanionButtonStepActions,
	CompanionPresetDefinitions,
	CompanionPresetFeedbackStyleOverride,
	CompanionPresetSection,
	CompanionLayeredButtonPresetDefinition,
	SomeButtonGraphicsElement,
} from '@companion-module/base'
import {
	KEY_ACTIVE_PNG64,
	KEY_IDLE_PNG64,
	STATUS_ACTIVE_PNG64,
	STATUS_INACTIVE_PNG64,
	STATUS_OFFLINE_PNG64,
	STATUS_UNKNOWN_PNG64,
} from './key-images.js'
import type ModuleInstance from './main.js'
import { INPUT_LANGUAGES } from './languages.js'
import type { ModuleSchema } from './main.js'

// Key-Hintergründe aus scripts/generate-keys.ts (yarn keys), Aufbau wie beim Proxmox-Modul: kleines Logo oben,
// Text in der Mitte, unten Akzentstreifen bzw. beim Start-&-Stop-Button ein Status-Band mit eigenem Textlayer.
//
// WICHTIG (Stand 30.08.2026, bestätigt auf Companion 5.0.4): Modul-definierte Feedbacks auf einem 'layered'
// Preset kommen beim Ziehen auf einen Button leer an - offener Bug bitfocus/companion#4410. Elemente/Steps
// werden dagegen zuverlässig übernommen. Der Start-&-Stop-Button kommt deshalb ganz ohne Feedbacks aus: Texte
// über die Variablen import_action/import_status, die Zustandsbilder über Expressions auf "enabled"
// (Companion-Doku "Button Graphics Elements": jede Element-Eigenschaft darf eine Expression sein).
const COLOR_TEXT_WHITE = 0xffffff
/** Sprachen mit fertigem Preset; alle übrigen über die Aktion "Ursprungssprache setzen". */
const PRESET_LANGUAGES = ['de', 'en', 'fr', 'it', 'es']

function imageElement(id: string, name: string, base64: string, enabledByDefault: boolean): SomeButtonGraphicsElement {
	return {
		type: 'image',
		id,
		name,
		x: 0,
		y: 0,
		width: 100,
		height: 100,
		opacity: 100,
		enabled: enabledByDefault,
		base64Image: base64,
		fillMode: 'crop',
	}
}

interface TextBounds {
	y: number
	height: number
	fontsize: number
}

// Angaben in Prozent des Buttons (fontsize in Prozent der Elementhöhe). Das Logo belegt oben ca. 5-28 %, der
// Akzentstreifen die untersten 6 %, das Status-Band die untersten 20 % (siehe scripts/generate-keys.ts).
const STATIC_TEXT_BOUNDS: TextBounds = { y: 30, height: 63, fontsize: 25 }
const TOGGLE_TEXT_BOUNDS: TextBounds = { y: 30, height: 50, fontsize: 32 }
const STATUS_TEXT_BOUNDS: TextBounds = { y: 80, height: 20, fontsize: 58 }

function mainTextElement(text: string, bounds: TextBounds, id = 'main', name = 'Haupttext'): SomeButtonGraphicsElement {
	return {
		type: 'text',
		id,
		name,
		x: 0,
		y: bounds.y,
		width: 100,
		height: bounds.height,
		rotation: 0,
		opacity: 100,
		text,
		font: 'companion-sans',
		weight: 'bold',
		fontsize: bounds.fontsize,
		fontsizeAllowShrink: true,
		color: COLOR_TEXT_WHITE,
		halign: 'center',
		valign: 'center',
	}
}

/** Zustandsbild, das sichtbar ist, solange import_state den angegebenen Wert hat (Expression, ohne Feedback). */
function importStateImage(id: string, name: string, base64: string, state: string): SomeButtonGraphicsElement {
	return {
		...imageElement(id, name, base64, true),
		enabled: { isExpression: true, value: `$(livevoice:import_state) == '${state}'` },
	}
}

/** Blendet ein Zustands-Bild ein und das Standard-Bild (idle) aus. Opacity bleibt immer 100 - nur "enabled" steuert die Sichtbarkeit. */
function showImageOverride(hideId: string, showId: string): CompanionPresetFeedbackStyleOverride[] {
	return [
		{ elementId: hideId, elementProperty: 'enabled', override: false },
		{ elementId: showId, elementProperty: 'enabled', override: true },
	]
}

function buildSteps(
	actionId: 'startImport' | 'stopImport' | 'toggleImport' | 'toggleAi',
	channelId = 'auto',
): CompanionButtonStepActions<ModuleSchema>[] {
	return [{ down: [{ actionId, options: { channelId } }], up: [] }]
}

/** Sprach-Button: setzt die Ursprungssprache des Quell-Channels, leuchtet, solange sie aktiv ist. */
function buildLanguagePreset(language: string, label: string): CompanionLayeredButtonPresetDefinition<ModuleSchema> {
	return {
		type: 'layered',
		name: `Ursprungssprache ${label}`,
		elements: [
			imageElement('bg-idle', 'Hintergrund (idle)', KEY_IDLE_PNG64, true),
			imageElement('bg-active', 'Hintergrund (aktiv)', KEY_ACTIVE_PNG64, false),
			mainTextElement(`O-Ton ${language.toUpperCase()}`, STATIC_TEXT_BOUNDS),
		],
		feedbacks: [
			{
				feedbackId: 'sourceLanguage',
				options: { channelId: 'auto', language },
				styleOverrides: showImageOverride('bg-idle', 'bg-active'),
			},
		],
		steps: [
			{
				down: [{ actionId: 'setSourceLanguage', options: { channelId: 'auto', language, manageHiding: true } }],
				up: [],
			},
		],
	}
}

/** Stimmen-Button: setzt die Stimme aller AI-Channels, leuchtet, solange sie aktiv ist. */
function buildVoicePreset(
	voice: 'male' | 'female',
	text: string,
): CompanionLayeredButtonPresetDefinition<ModuleSchema> {
	return {
		type: 'layered',
		name: `Stimme ${text}`,
		elements: [
			imageElement('bg-idle', 'Hintergrund (idle)', KEY_IDLE_PNG64, true),
			imageElement('bg-active', 'Hintergrund (aktiv)', KEY_ACTIVE_PNG64, false),
			mainTextElement(`Stimme ${text}`, STATIC_TEXT_BOUNDS),
		],
		feedbacks: [
			{ feedbackId: 'voiceIs', options: { voice }, styleOverrides: showImageOverride('bg-idle', 'bg-active') },
		],
		steps: [{ down: [{ actionId: 'setVoice', options: { voice } }], up: [] }],
	}
}

/** Ein AI-Toggle-Button pro Channel mit aktivierter AI-Übersetzung (Name des Channels als Text). */
function buildAiPreset(channelId: number, channelName: string): CompanionLayeredButtonPresetDefinition<ModuleSchema> {
	return {
		type: 'layered',
		name: `AI ${channelName}`,
		elements: [
			imageElement('bg-idle', 'Hintergrund (idle)', KEY_IDLE_PNG64, true),
			imageElement('bg-active', 'Hintergrund (aktiv)', KEY_ACTIVE_PNG64, false),
			mainTextElement(`AI ${channelName}`, STATIC_TEXT_BOUNDS),
		],
		feedbacks: [
			{
				feedbackId: 'aiActive',
				options: { channelId: String(channelId) },
				styleOverrides: showImageOverride('bg-idle', 'bg-active'),
			},
		],
		steps: buildSteps('toggleAi', String(channelId)),
	}
}

/** Start/Stop: statisches Aktions-Icon, kein Status-Feedback nötig. */
function buildStaticPreset(
	name: string,
	actionId: 'startImport' | 'stopImport',
	baseImage: string,
	text: string,
): CompanionLayeredButtonPresetDefinition<ModuleSchema> {
	return {
		type: 'layered',
		name,
		elements: [imageElement('background', 'Hintergrund', baseImage, true), mainTextElement(text, STATIC_TEXT_BOUNDS)],
		feedbacks: [],
		steps: buildSteps(actionId),
	}
}

export function UpdatePresets(self: ModuleInstance): void {
	// Start & Stop: oben die nächste Aktion ("Import starten"/"Import stoppen"), unten das Status-Band. Das
	// inaktive Bild liegt immer zuunterst, die übrigen werden per Expression auf import_state eingeblendet.
	const toggleImport: CompanionLayeredButtonPresetDefinition<ModuleSchema> = {
		type: 'layered',
		name: 'LiveVoice Start & Stop',
		elements: [
			imageElement('bg-idle', 'Hintergrund (inaktiv)', STATUS_INACTIVE_PNG64, true),
			importStateImage('bg-offline', 'Hintergrund (offline)', STATUS_OFFLINE_PNG64, 'offline'),
			importStateImage('bg-unknown', 'Hintergrund (unbekannt)', STATUS_UNKNOWN_PNG64, 'unknown'),
			importStateImage('bg-active', 'Hintergrund (aktiv)', STATUS_ACTIVE_PNG64, 'active'),
			mainTextElement('$(livevoice:import_action)', TOGGLE_TEXT_BOUNDS),
			mainTextElement('$(livevoice:import_status)', STATUS_TEXT_BOUNDS, 'status', 'Status'),
		],
		feedbacks: [],
		steps: buildSteps('toggleImport'),
	}

	const presets: CompanionPresetDefinitions<ModuleSchema> = {
		startImport: buildStaticPreset('LiveVoice Import starten', 'startImport', KEY_ACTIVE_PNG64, 'Import starten'),
		stopImport: buildStaticPreset('LiveVoice Import stoppen', 'stopImport', KEY_IDLE_PNG64, 'Import stoppen'),
		toggleImport,
	}

	const aiPresetIds: string[] = []
	for (const channel of self.client.getEvent().channels.values()) {
		if (!channel.hasAiTranslation) continue
		const id = `ai_${channel.id}`
		presets[id] = buildAiPreset(channel.id, channel.name)
		aiPresetIds.push(id)
	}

	presets.voice_male = buildVoicePreset('male', 'männlich')
	presets.voice_female = buildVoicePreset('female', 'weiblich')

	const languageIds: string[] = []
	for (const language of PRESET_LANGUAGES) {
		const id = `lang_${language}`
		presets[id] = buildLanguagePreset(language, INPUT_LANGUAGES[language])
		languageIds.push(id)
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{ id: 'import', name: 'LiveVoice', definitions: ['startImport', 'stopImport', 'toggleImport'] },
		{ id: 'language', name: 'LiveVoice Ursprungssprache', definitions: languageIds },
		{ id: 'voice', name: 'LiveVoice Stimme', definitions: ['voice_male', 'voice_female'] },
	]
	if (aiPresetIds.length > 0) {
		structure.push({ id: 'ai', name: 'LiveVoice AI-Übersetzung', definitions: aiPresetIds })
	}

	self.setPresetDefinitions(structure, presets)
}
