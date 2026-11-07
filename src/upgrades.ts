import type { CompanionStaticUpgradeScript } from '@companion-module/base'
import { DEFAULT_POLL_INTERVAL, DEFAULT_STATS_INTERVAL, type ModuleConfig, type ModuleSecrets } from './config.js'

/**
 * 0.3.x -> 0.4.0: Umstieg von der internen Webclient-Schnittstelle (Operator-Link) auf die Server API v2.
 * Neue Config-Felder bekommen Defaults; der Operator-Link entfällt ersatzlos (der API-Key muss neu
 * eingetragen werden). Actions/Feedbacks behalten IDs und Optionen.
 */
const upgradeToServerApi: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets> = (_context, props) => {
	const oldConfig = (props.config ?? {}) as Partial<ModuleConfig>
	const oldSecrets = (props.secrets ?? {}) as Partial<ModuleSecrets> & { operatorUrl?: string }

	return {
		updatedConfig: props.config
			? {
					eventId: oldConfig.eventId ?? 'auto',
					preferredChannelId: oldConfig.preferredChannelId ?? 'auto',
					pollInterval: oldConfig.pollInterval ?? DEFAULT_POLL_INTERVAL,
					statsInterval: oldConfig.statsInterval ?? DEFAULT_STATS_INTERVAL,
					webhookEnabled: oldConfig.webhookEnabled ?? false,
					debugLogging: oldConfig.debugLogging ?? false,
				}
			: null,
		updatedSecrets: props.secrets
			? { apiKey: oldSecrets.apiKey ?? '', webhookSecret: oldSecrets.webhookSecret ?? '' }
			: null,
		updatedActions: [],
		updatedFeedbacks: [],
	}
}

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets>[] = [
	// Einmal hinzugefügte Skripte dürfen nicht mehr entfernt werden!
	upgradeToServerApi,
]
