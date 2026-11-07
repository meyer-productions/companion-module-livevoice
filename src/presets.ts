import type {
	CompanionButtonStepActions,
	CompanionPresetDefinitions,
	CompanionPresetFeedbackStyleOverride,
	CompanionPresetSection,
	CompanionLayeredButtonPresetDefinition,
	SomeButtonGraphicsElement,
} from '@companion-module/base'
import { KEY_ACTIVE_PNG64, KEY_IDLE_PNG64, KEY_OFFLINE_PNG64, KEY_UNKNOWN_PNG64 } from './key-images.js'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'

// Key-Hintergründe aus DESIGN/Buttons/brand/keys/README-Keys.md (Icons ohne eingebrannten Text - der Text kommt
// komplett von Companion). Für den Toggle-Button liegen alle vier Zustandsbilder übereinander gestapelt
// (opacity immer 100, "enabled" steuert die Sichtbarkeit) - diese Struktur entspricht 1:1 dem vom Nutzer
// exportierten, funktionierenden Referenz-Button.
//
// WICHTIG (Stand 30.08.2026, bestätigt auf Companion 5.0.4): Modul-definierte Feedbacks auf einem 'layered'
// Preset kommen beim Ziehen auf einen Button leer an (Feedbacks-Tab bleibt leer), auch nach diversen
// strukturellen Varianten (mehrere gestapelte Bild-Elemente, ein einzelnes Bild-Element mit
// base64Image-Austausch) - live verifiziert per JSON-Export-Vergleich, reproduziert nach Neuinstallation und
// nach Companion-Update auf 5.0.4. Bestätigter offener Bug: bitfocus/companion#4410 "Linked Preset not
// working with Advanced Feedbacks" (offen, Milestone v5.1, kein verifizierter Fix). Elemente/Steps werden
// dagegen zuverlässig übernommen. Deshalb: Elemente exakt wie im geprüften Referenz-Button aufbauen (optisch
// korrekt sofort nach dem Ziehen) und die 3 Feedbacks einmalig manuell in der Companion-UI ergänzen (siehe
// HELP.md) - ein Umgehen des Bugs über eine andere Preset-Struktur hat sich nicht als möglich erwiesen.
const COLOR_TEXT_WHITE = 0xffffff

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

// Start/Stop (kürzerer, aber längerer Text "Start/Stop Import") und Toggle (nur der kurze Status-Wert) haben
// unterschiedliche Bänder/Grössen bekommen, beide wie vom Nutzer im Companion-Editor abgestimmt (Printscreen).
const STATIC_TEXT_BOUNDS: TextBounds = { y: 65, height: 35, fontsize: 45 }
const TOGGLE_TEXT_BOUNDS: TextBounds = { y: 55, height: 45, fontsize: 80 }

function mainTextElement(text: string, bounds: TextBounds): SomeButtonGraphicsElement {
	return {
		type: 'text',
		id: 'main',
		name: 'Haupttext',
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
	// Start & Stop: alle vier Zustandsbilder gestapelt, "idle" per Default sichtbar - exakt die Element-Struktur
	// des vom Nutzer exportierten Referenz-Buttons. "idle" deckt auch "inactive" ab, deshalb kein eigenes
	// importOffline-Feedback hier - es würde sich mit importInactive überlappen (importInactive ist laut
	// Definition bei "inactive" ODER "offline" aktiv) und um denselben Vorrang konkurrieren. Das Bild
	// "bg-offline" bleibt als Layer trotzdem vorhanden, falls manuell ein eigenes Feedback dafür ergänzt wird.
	const toggleImport: CompanionLayeredButtonPresetDefinition<ModuleSchema> = {
		type: 'layered',
		name: 'LiveVoice Start & Stop',
		elements: [
			imageElement('bg-idle', 'Hintergrund (idle)', KEY_IDLE_PNG64, true),
			imageElement('bg-active', 'Hintergrund (aktiv)', KEY_ACTIVE_PNG64, false),
			imageElement('bg-offline', 'Hintergrund (offline)', KEY_OFFLINE_PNG64, false),
			imageElement('bg-unknown', 'Hintergrund (unbekannt)', KEY_UNKNOWN_PNG64, false),
			mainTextElement('$(livevoice:import_state)', TOGGLE_TEXT_BOUNDS),
		],
		feedbacks: [
			{
				feedbackId: 'importActive',
				options: { channelId: 'auto' },
				styleOverrides: showImageOverride('bg-idle', 'bg-active'),
			},
			{
				feedbackId: 'importInactive',
				options: { channelId: 'auto' },
				styleOverrides: [
					{ elementId: 'main', elementProperty: 'color', override: COLOR_TEXT_WHITE },
					...showImageOverride('bg-active', 'bg-idle'),
				],
			},
			{
				feedbackId: 'importUnknown',
				options: { channelId: 'auto' },
				styleOverrides: showImageOverride('bg-idle', 'bg-unknown'),
			},
		],
		steps: buildSteps('toggleImport'),
	}

	const presets: CompanionPresetDefinitions<ModuleSchema> = {
		startImport: buildStaticPreset('LiveVoice Start Import', 'startImport', KEY_ACTIVE_PNG64, 'Start Import'),
		stopImport: buildStaticPreset('LiveVoice Stop Import', 'stopImport', KEY_IDLE_PNG64, 'Stop Import'),
		toggleImport,
	}

	const aiPresetIds: string[] = []
	for (const channel of self.client.getEvent().channels.values()) {
		if (!channel.hasAiTranslation) continue
		const id = `ai_${channel.id}`
		presets[id] = buildAiPreset(channel.id, channel.name)
		aiPresetIds.push(id)
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{ id: 'import', name: 'LiveVoice', definitions: ['startImport', 'stopImport', 'toggleImport'] },
	]
	if (aiPresetIds.length > 0) {
		structure.push({ id: 'ai', name: 'LiveVoice AI-Übersetzung', definitions: aiPresetIds })
	}

	self.setPresetDefinitions(structure, presets)
}
