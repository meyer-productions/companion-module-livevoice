/**
 * Erzeugt die Key-Hintergründe (144x144 PNG, base64) nach src/key-images.ts - reines Node (zlib), keine
 * Bildbibliothek. Formen werden mit 4x4-Supersampling gerastert (weiche Kanten).
 *
 * Aufbau (wie beim Proxmox-Modul): kleines LiveVoice-Logo (Balken) oben, Mitte frei für den Companion-Text,
 * unten entweder ein schmaler Akzentstreifen (KEY_*) oder ein Status-Band für einen Textlayer (STATUS_*).
 * Farben aus DESIGN/Buttons/brand/keys/README-Keys.md.
 *
 * Ausführen: yarn keys
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SIZE = 144
const SAMPLES = 4

/** Höhe des Akzentstreifens der einfachen Keys (wie im ursprünglichen Design, ~6 %). */
const STRIPE_HEIGHT = 9
/** Höhe des Status-Bands (20 %), muss zu STATUS_BAND_TOP in presets.ts passen. */
const BAND_HEIGHT = 29

/** Logo: 5 Balken, ca. halb so gross wie im ursprünglichen Design, zentriert im oberen Viertel. */
const LOGO_CENTER_Y = 25
const BAR_WIDTH = 5
const BAR_PITCH = 9.5
const BAR_HEIGHTS = {
	full: [14, 26, 33, 26, 14],
	half: [5, 14, 26, 14, 5],
	flat: [5, 5, 5, 5, 5],
}

type Rgb = [number, number, number]
const hex = (value: number): Rgb => [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]

const ORANGE = hex(0xf56230)
const BG_ACTIVE = hex(0x1a1310)
const BG_IDLE = hex(0x1a2026)
const BG_OFFLINE = hex(0x12161a)
const BAR_IDLE = hex(0x4a555c)
const BAR_OFFLINE = hex(0x39434a)
const BAND_IDLE = hex(0x3a444b)
const BAND_OFFLINE = hex(0x232b31)
const HATCH = hex(0x2c353b)

/** Liefert die Farbe eines Punkts oder undefined (dann gilt die darunterliegende Ebene). */
type Layer = (x: number, y: number) => Rgb | undefined

function logo(heights: number[], color: Rgb): Layer {
	return (x, y) => {
		for (let i = 0; i < heights.length; i++) {
			const cx = SIZE / 2 + (i - 2) * BAR_PITCH
			const h = heights[i]
			if (Math.abs(x - cx) <= BAR_WIDTH / 2 && Math.abs(y - LOGO_CENTER_Y) <= h / 2) return color
		}
		return undefined
	}
}

function band(height: number, color: Rgb, hatch?: Rgb): Layer {
	return (x, y) => {
		if (y < SIZE - height) return undefined
		// Diagonale Schraffur (8 px Periode), z.B. für "unbekannt"
		if (hatch && (x + y) % 8 < 3) return hatch
		return color
	}
}

function render(background: Rgb, layers: Layer[]): Buffer {
	const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE)
	for (let py = 0; py < SIZE; py++) {
		raw[py * (SIZE * 3 + 1)] = 0 // Filter: none
		for (let px = 0; px < SIZE; px++) {
			const sum = [0, 0, 0]
			for (let sy = 0; sy < SAMPLES; sy++) {
				for (let sx = 0; sx < SAMPLES; sx++) {
					const x = px + (sx + 0.5) / SAMPLES
					const y = py + (sy + 0.5) / SAMPLES
					let color = background
					for (const layer of layers) color = layer(x, y) ?? color
					for (let c = 0; c < 3; c++) sum[c] += color[c]
				}
			}
			const offset = py * (SIZE * 3 + 1) + 1 + px * 3
			for (let c = 0; c < 3; c++) raw[offset + c] = Math.round(sum[c] / (SAMPLES * SAMPLES))
		}
	}
	return encodePng(raw)
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	return c >>> 0
})

function crc32(data: Buffer): number {
	let crc = 0xffffffff
	for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
	return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4)
	length.writeUInt32BE(data.length)
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(body))
	return Buffer.concat([length, body, crc])
}

function encodePng(raw: Buffer): Buffer {
	const header = Buffer.alloc(13)
	header.writeUInt32BE(SIZE, 0)
	header.writeUInt32BE(SIZE, 4)
	header[8] = 8 // Bit-Tiefe
	header[9] = 2 // RGB
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	])
}

const images: Record<string, { comment: string; png: Buffer }> = {
	KEY_ACTIVE_PNG64: {
		comment: 'Einfacher Key, aktiv: oranges Logo, oranger Streifen',
		png: render(BG_ACTIVE, [logo(BAR_HEIGHTS.full, ORANGE), band(STRIPE_HEIGHT, ORANGE)]),
	},
	KEY_IDLE_PNG64: {
		comment: 'Einfacher Key, nicht aktiv: graues Logo, grauer Streifen',
		png: render(BG_IDLE, [logo(BAR_HEIGHTS.full, BAR_IDLE), band(STRIPE_HEIGHT, BAND_IDLE)]),
	},
	STATUS_ACTIVE_PNG64: {
		comment: 'Status-Key, Import läuft: oranges Band',
		png: render(BG_ACTIVE, [logo(BAR_HEIGHTS.full, ORANGE), band(BAND_HEIGHT, ORANGE)]),
	},
	STATUS_INACTIVE_PNG64: {
		comment: 'Status-Key, Import aus: graues Band',
		png: render(BG_IDLE, [logo(BAR_HEIGHTS.full, BAR_IDLE), band(BAND_HEIGHT, BAND_IDLE)]),
	},
	STATUS_OFFLINE_PNG64: {
		comment: 'Status-Key, Channel offline: flache Punktreihe, dunkles Band',
		png: render(BG_OFFLINE, [logo(BAR_HEIGHTS.flat, BAR_OFFLINE), band(BAND_HEIGHT, BAND_OFFLINE)]),
	},
	STATUS_UNKNOWN_PNG64: {
		comment: 'Status-Key, unbekannt: halbe Balken, schraffiertes Band',
		png: render(BG_IDLE, [logo(BAR_HEIGHTS.half, BAR_IDLE), band(BAND_HEIGHT, BAND_IDLE, HATCH)]),
	},
}

const lines = [
	'// Generiert von scripts/generate-keys.ts (yarn keys) - nicht von Hand bearbeiten.',
	'// 144x144 PNG: kleines Logo oben, Mitte frei für den Text, unten Akzentstreifen (KEY_*) bzw. Status-Band',
	'// (STATUS_*, Band = unterste 20 %, Text kommt als eigener Layer aus presets.ts).',
	'',
]
for (const [name, { comment, png }] of Object.entries(images)) {
	lines.push(`/** ${comment} */`, `export const ${name} =`, `\t'data:image/png;base64,${png.toString('base64')}'`)
}
lines.push('')

const target = fileURLToPath(new URL('../src/key-images.ts', import.meta.url))
writeFileSync(target, lines.join('\n'))

const previewDir = process.argv.includes('--preview') ? process.argv[process.argv.indexOf('--preview') + 1] : undefined
if (previewDir) {
	for (const [name, { png }] of Object.entries(images)) writeFileSync(`${previewDir}/${name}.png`, png)
}
console.log(`${Object.keys(images).length} Key-Bilder nach ${target} geschrieben`)
