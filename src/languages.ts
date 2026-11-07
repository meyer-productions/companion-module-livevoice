import type { DropdownChoice } from '@companion-module/base'

/** Gesprochene Sprachen laut LiveVoice Server API v2 (`InputLanguage`), mit deutschem Anzeigenamen. */
export const INPUT_LANGUAGES: Record<string, string> = {
	af: 'Afrikaans',
	am: 'Amharisch',
	ar: 'Arabisch',
	az: 'Aserbaidschanisch',
	bg: 'Bulgarisch',
	bn: 'Bengalisch',
	bs: 'Bosnisch',
	ca: 'Katalanisch',
	cs: 'Tschechisch',
	da: 'Dänisch',
	de: 'Deutsch',
	el: 'Griechisch',
	en: 'Englisch',
	es: 'Spanisch',
	et: 'Estnisch',
	eu: 'Baskisch',
	fa: 'Persisch',
	fi: 'Finnisch',
	fil: 'Filipino',
	fr: 'Französisch',
	ga: 'Irisch',
	gl: 'Galicisch',
	he: 'Hebräisch',
	hi: 'Hindi',
	hr: 'Kroatisch',
	hu: 'Ungarisch',
	hy: 'Armenisch',
	id: 'Indonesisch',
	is: 'Isländisch',
	it: 'Italienisch',
	ja: 'Japanisch',
	ka: 'Georgisch',
	kk: 'Kasachisch',
	km: 'Khmer',
	ko: 'Koreanisch',
	lo: 'Laotisch',
	lt: 'Litauisch',
	lv: 'Lettisch',
	ne: 'Nepalesisch',
	nl: 'Niederländisch',
	no: 'Norwegisch',
	mk: 'Mazedonisch',
	ml: 'Malayalam',
	mn: 'Mongolisch',
	mr: 'Marathi',
	ms: 'Malaiisch',
	mt: 'Maltesisch',
	my: 'Birmanisch',
	pl: 'Polnisch',
	pa: 'Panjabi',
	'pt-PT': 'Portugiesisch (Portugal)',
	'pt-BR': 'Portugiesisch (Brasilien)',
	ro: 'Rumänisch',
	ru: 'Russisch',
	sk: 'Slowakisch',
	sl: 'Slowenisch',
	so: 'Somali',
	sq: 'Albanisch',
	sr: 'Serbisch',
	sv: 'Schwedisch',
	sw: 'Suaheli',
	ta: 'Tamil',
	te: 'Telugu',
	th: 'Thailändisch',
	tr: 'Türkisch',
	uk: 'Ukrainisch',
	ur: 'Urdu',
	vi: 'Vietnamesisch',
	'zh-HK': 'Chinesisch (Hongkong)',
	'zh-CN': 'Chinesisch (vereinfacht)',
	'zh-TW': 'Chinesisch (traditionell)',
}

/** Häufige Sprachen zuerst, danach alphabetisch nach Anzeigename. */
const TOP_LANGUAGES = ['de', 'en', 'fr', 'it', 'es', 'uk']

export function languageChoices(): DropdownChoice[] {
	const rest = Object.keys(INPUT_LANGUAGES)
		.filter((code) => !TOP_LANGUAGES.includes(code))
		.sort((a, b) => INPUT_LANGUAGES[a].localeCompare(INPUT_LANGUAGES[b], 'de'))
	return [...TOP_LANGUAGES, ...rest].map((code) => ({ id: code, label: `${INPUT_LANGUAGES[code]} (${code})` }))
}

export function isInputLanguage(code: string): boolean {
	return Object.hasOwn(INPUT_LANGUAGES, code)
}
