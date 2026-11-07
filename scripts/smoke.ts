/**
 * Schreibgeschützter Smoke-Test gegen die echte LiveVoice Server API (nur GET-Requests).
 * Aufruf: yarn smoke  (liest LIVEVOICE_API_KEY und optional LIVEVOICE_EVENT_ID aus .env)
 * Der API-Key wird nie ausgegeben.
 */
import { LiveVoiceApi } from '../src/api.js'
import { selectDefaultImportChannel, toChannel } from '../src/state.js'

const apiKey = process.env.LIVEVOICE_API_KEY?.trim()
if (!apiKey) {
	throw new Error('LIVEVOICE_API_KEY fehlt (.env)')
}

const api = new LiveVoiceApi(apiKey)

const account = await api.getAccount()
console.log(`Konto: tier=${account.tier ?? '-'} features=${(account.features ?? []).join(', ')}`)

const events = await api.listEvents()
console.log(`\nEvents (${events.length}):`)
for (const event of events) console.log(`  ${event.id}  ${event.state ?? '?'}  ${event.name}`)

const configured = process.env.LIVEVOICE_EVENT_ID?.trim()
const active = events.filter((event) => event.state === 'active')
const eventId = configured ? Number(configured) : active.length === 1 ? active[0].id : undefined

if (eventId !== undefined) {
	const rawChannels = await api.listChannels(eventId)
	const channels = rawChannels.map((raw) => toChannel(raw))
	console.log(`\nChannels von Event ${eventId}:`)
	for (const channel of channels) {
		console.log(
			`  ${channel.id}  ${(channel.state ?? '?').padEnd(17)} import=${channel.importState.padEnd(8)} ` +
				`audio=${channel.hasAudioInput} ai=${channel.hasAiTranslation}${channel.aiSourceChannelId ? `(<-${channel.aiSourceChannelId})` : ''}  ${channel.name}`,
		)
	}
	const auto = selectDefaultImportChannel(channels)
	console.log(`\nAuto-Import-Channel: ${auto ? `${auto.name} (${auto.id})` : 'nicht eindeutig'}`)
} else {
	console.log('\nKein eindeutiges Event - LIVEVOICE_EVENT_ID in .env setzen, um Channels zu sehen.')
}

console.log(`\nRequests verbraucht: ${api.budget.usedLastHour()}`)
