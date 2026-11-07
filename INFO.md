> **Historisch:** Diese Notizen beschreiben die interne Webclient-Schnittstelle (Operator-Link, ActionCable), die
> das Modul bis Version 0.3.x genutzt hat. Ab 0.4.0 läuft das Modul über die offizielle LiveVoice Server API v2
> (siehe [companion/HELP.md](./companion/HELP.md)). Das Dokument bleibt nur als Referenz erhalten.

# Claude Code Briefing: Bitfocus Companion Modul für LiveVoice

Stand: 30.08.2026

## 1. Ziel

Baue ein eigenständiges Bitfocus-Companion-Connection-Modul für LiveVoice.

Das Modul soll LiveVoice **direkt** über die vom Webclient verwendete HTTP-/WebSocket-Schnittstelle steuern. Es soll **keinen Browser, kein Selenium und keine PowerShell-Hilfsskripte** benötigen.

Primäres Konfigurationsziel:

- Der Benutzer gibt möglichst nur den **LiveVoice Operator-Link** ein.
- Das Modul liest daraus bzw. aus der geladenen Operator-Seite alle benötigten Verbindungsparameter automatisch aus.
- Danach authentifiziert sich das Modul bei LiveVoice.
- Es hält eine ActionCable-WebSocket-Verbindung dauerhaft offen.
- Es stellt Actions für Start/Stop/Toggle des Audio-Imports bereit.
- Es liefert echte Companion-Feedbacks und Variablen basierend auf dem **tatsächlichen LiveVoice-Zustand**, nicht auf dem zuletzt gesendeten Befehl.

Beispiel-Operator-Link:

```text
https://livevoice.io/de/events/operator/jPrB9A76r6v-kGqQob5BES15qEJBbqgzc6s24EEDxck
```

Wichtig: Der Operator-Link ist als Zugangsinformation zu behandeln. Nicht in Logs oder Fehlermeldungen vollständig ausgeben.

---

## 2. Wichtige technische Erkenntnis

Die LiveVoice-Operator-Seite enthält bereits die Daten, die der LiveVoice-Webclient für die Authentifizierung braucht.

Im untersuchten HTML befindet sich ein Element mit `data-controller="... streaming"` und mindestens diesen relevanten Data-Attributes:

```html
data-streaming-api-headers="{...}"
data-streaming-api-url="https://livevoice.io/api/v2/authenticate?join_code=888154&user_name=Operator+2a2297a1"
```

`data-streaming-api-headers` enthielt im Test unter anderem:

```json
{
	"api-key": "2yoWWe9nbAYpalZG8iDEFGIcC5tHJ2",
	"client-identifier": "ba6a0f7e-f78d-4cf9-894c-1828f3d743cb",
	"client-os": "Windows",
	"client-os-version": "10.0",
	"client-product": "io.livevoice.client.web",
	"client-hardware-model": "Unknown",
	"client-preferred-locale": "de",
	"client-browser": "Microsoft Edge",
	"client-browser-version": "152",
	"client-role": "operator",
	"client-operator-token": "jPrB9A76r6v-kGqQob5BES15qEJBbqgzc6s24EEDxck"
}
```

Das ist entscheidend: **API-Key, Client-Identifier, Operator-Token, Join-Code und Auth-URL müssen nicht hart codiert werden**, wenn sie zuverlässig aus dem Operator-HTML extrahiert werden können.

### Sicherheits-/Robustheitsregel

Die oben gezeigten Werte sind nur ein **beobachtetes Testbeispiel**. Nicht als feste Produktkonstanten verwenden.

Das Modul soll die Werte bei jeder Initialisierung/Verbindungsaufnahme aus dem Operator-HTML lesen, insbesondere:

- `api-key`
- `client-identifier`
- `client-operator-token`
- `client-product`
- `client-role`
- `client-os`
- `client-os-version`
- `client-browser`
- `client-browser-version`
- `client-hardware-model`
- `client-preferred-locale`
- `data-streaming-api-url`

Falls LiveVoice neue Header ergänzt, soll die Implementierung möglichst alle Key/Value-Paare aus `data-streaming-api-headers` übernehmen, statt eine fixe Allowlist zu verwenden.

---

## 3. Beobachtung zum Operator-Link

Im HAR war der eigentliche Seitenrequest als verkürzte Route sichtbar:

```text
https://livevoice.io/de/events/operator/jPrB9A76
```

Das HTML selbst enthielt jedoch den vollständigen Operator-Token:

```text
jPrB9A76r6v-kGqQob5BES15qEJBbqgzc6s24EEDxck
```

Der vom Benutzer bereitgestellte vollständige Operator-Link lautet ebenfalls mit dem langen Token.

Daraus folgt:

- Nicht davon ausgehen, dass der sichtbare/requestete URL-Pfad zwingend der vollständige Operator-Token ist.
- Die **vom Benutzer eingegebene URL laden**.
- Den tatsächlichen `client-operator-token` aus `data-streaming-api-headers` als autoritative Quelle verwenden.
- Redirects erlauben.
- Die finale Response-URL kann gespeichert werden, aber nicht als alleinige Quelle für den Token verwenden.

---

## 4. Verbindungsablauf

### Phase A: Operator-Seite laden

HTTP GET:

```text
GET <Operator URL>
```

Beispiel:

```text
GET https://livevoice.io/de/events/operator/jPrB9A76r6v-kGqQob5BES15qEJBbqgzc6s24EEDxck
```

Aus dem HTML extrahieren:

1. `data-streaming-api-url`
2. `data-streaming-api-headers`

Die JSON-Zeichenkette in `data-streaming-api-headers` ist HTML-escaped, z. B. `&quot;`.
Vor `JSON.parse()` HTML Entities decodieren.

Empfohlene Strategie:

- HTML mit einem robusten HTML-Parser parsen, nicht mit einem fragilen Regex über das ganze Dokument.
- Element mit Attribut `data-streaming-api-url` suchen.
- Data-Attribute auslesen.
- HTML-Entities decodieren.
- JSON parsen.

Falls kein Element gefunden wird:

- Companion-Status auf `ConnectionFailure`/passenden Fehlerstatus setzen.
- Benutzerfreundliche Fehlermeldung: Operator-Link konnte nicht als LiveVoice-Operator-Seite erkannt werden.
- Keine sensiblen URL-/Tokenwerte vollständig loggen.

### Phase B: Authenticate

Im Test wurde folgender Request ausgeführt:

```text
POST https://livevoice.io/api/v2/authenticate?join_code=888154&user_name=Operator+2a2297a1
```

Die Header stammen direkt aus `data-streaming-api-headers`.

Beobachtete Header:

```text
api-key: 2yoWWe9nbAYpalZG8iDEFGIcC5tHJ2
client-identifier: ba6a0f7e-f78d-4cf9-894c-1828f3d743cb
client-operator-token: jPrB9A76r6v-kGqQob5BES15qEJBbqgzc6s24EEDxck
client-product: io.livevoice.client.web
client-role: operator
client-os: Windows
client-os-version: 10.0
client-browser: Microsoft Edge
client-browser-version: 152
client-hardware-model: Unknown
client-preferred-locale: de
Origin: https://livevoice.io
Referer: <Operator URL>
Accept: */*
```

Wichtig:

- Ohne `api-key` antwortete LiveVoice mit:
  ```json
  { "error": "invalid_api_key" }
  ```
- Mit API-Key, aber ohne gültigen `client-identifier`, antwortete LiveVoice mit:
  ```json
  { "error": "invalid_device_id" }
  ```
- Mit den aus dem Operator-HTML übernommenen Headern war die Authentifizierung erfolgreich.

### Erfolgreiche Auth-Response

Beobachtetes Beispiel:

```json
{
	"role": "listener",
	"cable_url": "wss://livevoice.io/cable",
	"stun_urls": ["stun:stun.livevoice.io:10000"],
	"access_token": "<ephemeral token>",
	"client_id": 5771728,
	"connection_id": 12358033,
	"trace_id": "510002a6-175c-4e43-8bc0-65714d382333",
	"auto_resume_timeout": 1800000,
	"janus": {
		"listener_url": "wss://jss01.streaming.livevoice.io/janus-websocket",
		"auth_token": "<ephemeral janus token>"
	}
}
```

Hinweis: Die Response enthielt `"role":"listener"`, obwohl die Webclient-Header `client-role: operator` verwendeten und der anschliessende ActionCable-Kanal Operator-Aktionen wie `start_importing` akzeptierte. Daher nicht aufgrund des Response-Feldes `role` die Operator-Funktionalität deaktivieren.

Für dieses Companion-Modul wird **Janus nicht benötigt**, solange nur Importsteuerung und Status/Statistik über ActionCable umgesetzt werden.

---

## 5. ActionCable-WebSocket

Aus der Auth-Response:

```text
cable_url = wss://livevoice.io/cable
```

Verbindung:

```text
wss://livevoice.io/cable?access_token=<access_token>
```

Beim WebSocket-Handshake wurde im Browser beobachtet:

```text
Origin: https://livevoice.io
```

### ActionCable-Protokoll

Nach Verbindungsaufbau sendet Server:

```json
{ "type": "welcome" }
```

Dann Client subscriben:

```json
{
	"command": "subscribe",
	"identifier": "{\"channel\":\"V2Channel\"}"
}
```

Server bestätigt:

```json
{
	"identifier": "{\"channel\":\"V2Channel\"}",
	"type": "confirm_subscription"
}
```

Danach wird eine `init_event`-Nachricht empfangen.

---

## 6. Ping/Pong

LiveVoice ActionCable sendet Ping-Nachrichten, z. B.:

```json
{
	"type": "ping",
	"message": 1788077982
}
```

Der untersuchte Webclient antwortete mit:

```json
{
	"command": "pong"
}
```

Das Companion-Modul soll auf jeden ActionCable-Ping mit `{"command":"pong"}` antworten.

Nicht nur auf TCP/WebSocket-Level-Ping verlassen; die beobachtete LiveVoice-Anwendung nutzt diese JSON-Nachrichten.

---

## 7. Initial Event / automatische Discovery

Nach erfolgreichem Subscribe wurde im Test folgende Nachricht empfangen:

```json
{
	"identifier": "{\"channel\":\"V2Channel\"}",
	"message": {
		"type": "init_event",
		"event_id": 64447,
		"name": "ICF BL Celebration",
		"listener_join_code": "888154",
		"listener_share_url": "https://livevoice.io/listen/888154",
		"channels": [
			{
				"id": 125145,
				"name": "Original Audio",
				"state": {
					"type": "offline"
				},
				"is_child": false,
				"delay": 0,
				"is_video_enabled": false,
				"has_subtitles": false,
				"has_audio": true,
				"sort_order": 10000,
				"janus_mountpoint": 125145,
				"janus_mountpoint_pin": "888154",
				"is_on_demand": false
			},
			{
				"id": 125147,
				"name": "English",
				"state": {
					"type": "offline"
				},
				"is_child": false,
				"delay": 0,
				"has_subtitles": true,
				"has_audio": true
			},
			{
				"id": 126435,
				"name": "Français",
				"state": {
					"type": "offline"
				},
				"is_child": false,
				"delay": 0,
				"has_subtitles": true,
				"has_audio": true
			},
			{
				"id": 126008,
				"name": "Українська",
				"state": {
					"type": "offline"
				},
				"is_child": false,
				"delay": 0,
				"has_subtitles": true,
				"has_audio": true
			}
		]
	}
}
```

### Konsequenz für das Companion-Modul

Die Channel-ID darf nicht hart codiert werden.

Das Modul soll nach `init_event`:

- Event-ID speichern
- Event-Name speichern
- Join-Code speichern
- alle Channels speichern
- Auswahlmöglichkeiten für Actions/Feedbacks dynamisch aus den Channels erzeugen bzw. die aktuelle Konfiguration aktualisieren

### Standard-Channel für Import

Für das untersuchte Event:

```text
125145 = Original Audio
```

Sinnvolle automatische Erkennung des Import-Source-Channels:

1. Bevorzugt Channel mit `has_audio === true` und `has_subtitles === false`.
2. Falls exakt einer existiert: als Default verwenden.
3. Falls mehrere existieren: Benutzer muss Channel in der Modulkonfiguration oder Action auswählen.
4. Der Name `Original Audio` darf als zusätzlicher Hint verwendet werden, aber nicht als einzige Logik.
5. Nicht davon ausgehen, dass die Channel-ID zwischen Events stabil ist.

---

## 8. Import starten

Der Webclient sendet exakt folgende ActionCable-Nachricht:

```json
{
	"command": "message",
	"identifier": "{\"channel\":\"V2Channel\"}",
	"data": "{\"channel_id\":125145,\"action\":\"start_importing\"}"
}
```

Wichtig: `data` ist **ein JSON-String innerhalb des äusseren JSON-Objekts**, kein verschachteltes Objekt.

Generisches Schema:

```ts
const identifier = JSON.stringify({ channel: 'V2Channel' })

const data = JSON.stringify({
	channel_id: channelId,
	action: 'start_importing',
})

const message = JSON.stringify({
	command: 'message',
	identifier,
	data,
})

ws.send(message)
```

---

## 9. Import stoppen

Erwartete/aus dem UI abgeleitete Action:

```json
{
	"command": "message",
	"identifier": "{\"channel\":\"V2Channel\"}",
	"data": "{\"channel_id\":125145,\"action\":\"stop_importing\"}"
}
```

Die bisher getestete PowerShell-Implementierung nutzt entsprechend:

```text
action = stop_importing
```

Im nach Start empfangenen `channel_updated`-Markup befand sich:

```html
data-action="streaming-channel#stopImporting"
```

und der deutsche Buttontext:

```text
Import stoppen
```

Das bestätigt, dass LiveVoice nach dem erfolgreichen Start den Channel als importierend darstellt.

Hinweis: Im bereitgestellten HAR wurde explizit der **Start** aufgezeichnet. Ein separater WebSocket-Frame des Stop-Klicks wurde nicht aufgezeichnet. `stop_importing` ist aus der bereits funktionierenden Gegenaktion/Implementierung und dem UI-Controller-Namen abgeleitet. Falls maximale Protokollverifikation gewünscht ist, später einmal einen Stop-Klick separat capturen.

---

## 10. Status / Feedbacks

Das Modul soll Feedbacks aus dem **LiveVoice-Serverstatus** ableiten, nicht aus lokalen Action-Aufrufen.

### Initialstatus

In `init_event`:

```json
{
	"id": 125145,
	"name": "Original Audio",
	"state": {
		"type": "offline"
	}
}
```

### Status nach Start

Nach `start_importing` wurde für Channel `125145` eine Nachricht empfangen:

```json
{
	"identifier": "{\"channel\":\"V2Channel\"}",
	"message": {
		"type": "channel_updated",
		"channel_id": 125145,
		"name": "Original Audio",
		"state_class": "active",
		"...": "..."
	}
}
```

In `settings_markup.de` befand sich danach:

```html
<a
	class="channel-btn channel-btn--primary btn btn-sm"
	data-action="streaming-channel#stopImporting"
	href="javascript:void(0);"
>
	... Import stoppen
</a>
```

### Primäre Statuslogik

Für den Import-Status zunächst folgende Priorität verwenden:

1. `channel_updated.state_class`
2. Initial `channel.state.type`
3. Nur als Fallback: `settings_markup` auf `stopImporting` / `startImporting` prüfen

Beobachtung:

```text
Vor Start:
state.type = offline

Nach Start:
channel_updated.state_class = active
settings_markup enthält stopImporting
```

Vorgeschlagene interne States:

```ts
type ImportState = 'active' | 'inactive' | 'offline' | 'unknown'
```

Da bisher nicht alle möglichen LiveVoice-Zustände aufgezeichnet wurden, unbekannte Werte niemals einfach als `inactive` interpretieren.

### Empfohlene Feedbacks

Mindestens:

- `Import active`
- `Import inactive`
- `Connected`
- `Disconnected`

Optional:

- `Channel state equals ...`
- `Listeners > 0`
- `Listeners == 0`
- `Selected channel active`
- `Any channel active`

Feedbacks müssen bei jeder relevanten WebSocket-Nachricht neu geprüft werden:

```ts
this.checkFeedbacks()
```

oder gezielt per Feedback-ID, je nach aktueller Companion-API.

---

## 11. Listener-Statistiken

LiveVoice sendete wiederholt:

```json
{
	"identifier": "{\"channel\":\"V2Channel\"}",
	"message": {
		"channel_id": 125145,
		"listeners": 0,
		"type": "statistics"
	}
}
```

Weitere beobachtete Channels:

```text
125145 Original Audio
125147 English
126435 Français
126008 Українська
```

Daraus können Companion-Variablen/Feedbacks entstehen.

Empfohlene Variablen:

```text
event_name
event_id
join_code
connection_status
selected_channel_id
selected_channel_name
import_state
listeners
```

Optional pro Channel dynamische Variablen, falls Companion dies sinnvoll/stabil unterstützt:

```text
channel_<id>_name
channel_<id>_state
channel_<id>_listeners
```

Vorsicht: Zu viele dynamische Variablen können bei wechselnden Events unübersichtlich werden. Bevorzugt einen `selected channel` plus generische Variablen implementieren.

---

## 12. Chat

Der Webclient sendete nach `init_event`:

```json
{
	"command": "message",
	"identifier": "{\"channel\":\"V2Channel\"}",
	"data": "{\"action\":\"fetch_chat_messages\"}"
}
```

Antwort:

```json
{
	"identifier": "{\"channel\":\"V2Channel\"}",
	"message": {
		"type": "chat_messages",
		"last_id": null,
		"has_more": false,
		"messages": []
	}
}
```

Chat ist für Version 1 des Companion-Moduls **nicht notwendig** und soll zunächst nicht implementiert werden.

---

## 13. Janus / Audio Streaming

Zusätzlich öffnet der LiveVoice-Webclient:

```text
wss://jss01.streaming.livevoice.io/janus-websocket
```

Beobachteter Janus-Ablauf:

```json
{
	"janus": "create",
	"transaction": "...",
	"token": "<ephemeral token>"
}
```

anschliessend:

```json
{
	"janus": "attach",
	"plugin": "janus.plugin.streaming",
	"transaction": "...",
	"token": "<ephemeral token>",
	"session_id": 1986539592202624
}
```

Für das gewünschte Companion-Modul wird Janus **nicht benötigt**, solange Companion selbst kein Audio abhören/streamen soll.

Nicht implementieren, ausser später entsteht eine explizite Anforderung dafür.

---

## 14. Reconnect-Strategie

Das Modul läuft dauerhaft in Companion und soll deshalb nicht wie das PowerShell-Testscript nach einem Befehl schliessen.

Gewünschter Lifecycle:

```text
Companion init
    ↓
Operator URL laden
    ↓
HTML Discovery
    ↓
Authenticate
    ↓
ActionCable verbinden
    ↓
V2Channel subscribe
    ↓
init_event verarbeiten
    ↓
dauerhaft:
  - ping/pong
  - channel_updated
  - statistics
  - Actions senden
    ↓
bei Disconnect:
  - Status setzen
  - kontrolliert reconnecten
```

### Reconnect-Anforderungen

- Exponential Backoff, z. B.:
  - 1 s
  - 2 s
  - 5 s
  - 10 s
  - max. 30 s
- Nach erfolgreicher Verbindung Backoff zurücksetzen.
- Bei Auth-Fehler zuerst Operator-Seite erneut laden, weil API-Key/Client-Identifier/URL geändert sein könnten.
- Access Token niemals dauerhaft speichern; bei Reconnect neu authentifizieren.
- Bei Konfigurationsänderung:
  - alte WebSocket-Verbindung sauber schliessen
  - State löschen
  - neu discovern/authentifizieren
- Ping/Pong berücksichtigen.
- WebSocket-Close/Error sauber behandeln.
- Keine Endlosschleifen mit aggressiven Reconnects.

---

## 15. Companion-Modul: gewünschte Konfiguration

### Minimaler Ansatz

Nur:

```text
Operator URL
```

Beispiel:

```text
https://livevoice.io/de/events/operator/jPrB9A76r6v-kGqQob5BES15qEJBbqgzc6s24EEDxck
```

Optional:

```text
Import Channel
```

Dieser sollte nach Discovery aus den `init_event.channels` auswählbar sein.

Problem: Companion-Konfigurationsfelder sind nicht immer ideal für dynamische Choices, die erst nach Verbindungsaufbau bekannt werden.

Alternative:

- Config enthält nur Operator URL.
- Actions enthalten `Channel` als Dropdown aus der zuletzt bekannten Channel-Liste.
- Zusätzlich eine Action `Start import on default source channel`.

### Empfohlene Config-Felder

1. `Operator URL` - Pflichtfeld
2. `Preferred import channel` - optional:
   - `auto`
   - Channel-ID als Text/Dropdown, wenn dynamisch möglich
3. `Debug logging` - Checkbox, default false

Keine manuellen Felder für:

- API Key
- Client Identifier
- Join Code
- Operator Token
- Event ID
- Cable URL

Diese Werte sollen automatisch ermittelt werden.

---

## 16. Companion Actions

Version 1 mindestens:

### `Start Import`

Optionen:

- Channel:
  - `Auto / Source Channel`
  - gefundene Channels

Sendet:

```json
{
  "channel_id": <channelId>,
  "action": "start_importing"
}
```

### `Stop Import`

Sendet:

```json
{
  "channel_id": <channelId>,
  "action": "stop_importing"
}
```

### `Toggle Import`

Logik:

```text
wenn tatsächlicher LiveVoice-State aktiv:
    stop_importing
sonst wenn eindeutig inaktiv/offline:
    start_importing
sonst:
    Action ablehnen / warnen
```

Nicht blind aufgrund eines lokalen Boolean toggeln.

---

## 17. Companion Feedbacks

Version 1:

### `Import is active`

Option:

- Channel

True wenn der beobachtete serverseitige State des Channels eindeutig aktiv/importierend ist.

### `Import is inactive`

Option:

- Channel

True wenn eindeutig nicht importierend.

### `LiveVoice connected`

True wenn:

- WebSocket offen
- V2Channel Subscription bestätigt

Nicht bereits nach erfolgreichem HTTP-Authenticate auf `connected` setzen.

### Optional: `Listener count`

Boolean-Vergleich:

- `=`
- `>`
- `<`
- `>=`
- `<=`

gegen `statistics.listeners`.

---

## 18. Companion Variablen

Mindestens:

```text
event_name
event_id
join_code
connection_status
import_channel_name
import_channel_id
import_state
listener_count
```

Beispielwerte:

```text
event_name = ICF BL Celebration
event_id = 64447
join_code = 888154
import_channel_name = Original Audio
import_channel_id = 125145
import_state = active
listener_count = 0
```

Nach jeder Zustandsänderung `setVariableValues()` aktualisieren.

---

## 19. Companion Presets

Sinnvolle Standard-Presets:

### Start Import

Text:

```text
START
IMPORT
```

Action:

- Start Import / Auto channel

Feedback:

- Wenn Import aktiv, Button visuell als aktiv markieren.

### Stop Import

Text:

```text
STOP
IMPORT
```

Action:

- Stop Import / Auto channel

### Toggle Import

Text über Variable:

```text
IMPORT
$(livevoice:import_state)
```

Oder statisch und über Feedback einfärben.

Keine Farben hart vorgeben, wenn die Companion-Konventionen/Template sinnvollere Defaults bieten; aber Feedbacks müssen nutzbar sein.

---

## 20. Connection Status in Companion

Empfohlene Zustände:

```text
Connecting
Ok
Disconnected
ConnectionFailure
BadConfig
```

Die konkreten Enum-Namen gemäss aktueller `@companion-module/base` API verwenden.

Statusbeispiele:

```text
Connecting to LiveVoice...
Connected: ICF BL Celebration
Disconnected - reconnecting
Invalid Operator URL
Authentication failed: invalid_api_key
Authentication failed: invalid_device_id
```

Keine Access Tokens oder vollständigen Operator-Tokens im Status anzeigen.

---

## 21. Logging / Secrets

### Niemals vollständig loggen

- Operator URL
- `client-operator-token`
- `access_token`
- Janus `auth_token`
- komplette Headerstruktur, wenn darin Secrets enthalten sind

### Erlaubtes Debug-Logging

```text
Operator URL loaded successfully
Discovered event authentication endpoint
Authentication successful
Cable connected
V2Channel subscribed
Event discovered: ICF BL Celebration (64447)
Channel discovered: Original Audio (125145)
Import state changed: offline -> active
Statistics: channel 125145 listeners=0
```

Token maskieren, falls zwingend benötigt:

```text
jPrB9A76...EEDxck
```

---

## 22. Fehlerbehandlung

Explizit behandeln:

### HTTP

- 4xx auf Operator URL
- 5xx
- Redirect-Loop
- HTML enthält keine Streaming-Data-Attributes
- ungültiges JSON in `data-streaming-api-headers`

### Authenticate

Bekannte Fehler:

```json
{ "error": "invalid_api_key" }
```

```json
{ "error": "invalid_device_id" }
```

Bei diesen Fehlern:

1. Operator-Seite neu laden.
2. Streaming-Headers erneut extrahieren.
3. Einmal neu authentifizieren.
4. Falls weiterhin Fehler: `ConnectionFailure`, keine aggressive Retry-Schleife.

### WebSocket

- kein `welcome`
- kein `confirm_subscription`
- Connection closed
- ungültige JSON-Nachricht
- unbekannter Message-Type

Unbekannte Messages ignorieren und bei Debug-Level protokollieren.

### Actions

Wenn Action ausgelöst wird, bevor Event/Channel Discovery abgeschlossen ist:

- Action nicht senden
- sinnvoll loggen
- keinen Crash verursachen

---

## 23. State-Modell

Empfohlene interne Struktur:

```ts
interface LiveVoiceChannel {
	id: number
	name: string
	hasAudio?: boolean
	hasSubtitles?: boolean
	isChild?: boolean
	stateType?: string
	stateClass?: string
	listeners?: number
	importState: 'active' | 'inactive' | 'offline' | 'unknown'
}

interface LiveVoiceEventState {
	eventId?: number
	name?: string
	joinCode?: string
	listenerShareUrl?: string
	channels: Map<number, LiveVoiceChannel>
}

interface LiveVoiceDiscovery {
	authUrl: string
	headers: Record<string, string>
	operatorToken?: string
}
```

Connection intern:

```ts
private ws?: WebSocket
private reconnectTimer?: NodeJS.Timeout
private reconnectAttempt = 0
private subscribed = false
private eventState: LiveVoiceEventState
```

---

## 24. Parsing `channel_updated`

Beobachtete Message:

```json
{
	"type": "channel_updated",
	"channel_id": 125145,
	"name": "Original Audio",
	"state_class": "active",
	"ai_paused_markup": { "...": "..." },
	"buttons_markup": { "...": "..." },
	"muted_markup": { "...": "..." },
	"settings_markup": { "...": "..." }
}
```

Für Status:

```ts
if (msg.state_class === 'active') {
	channel.importState = 'active'
}
```

Aber keine unbestätigten State-Kombinationen erfinden.

Fallback anhand des Markups:

```ts
const settings = Object.values(msg.settings_markup ?? {}).join('\n')

if (settings.includes('streaming-channel#stopImporting')) {
	channel.importState = 'active'
} else if (settings.includes('streaming-channel#startImporting')) {
	channel.importState = 'inactive'
}
```

Markup-Parsing ist **Fallback**, nicht Primärlogik.

Falls später ein Capture des Stop-Vorgangs einen eindeutigen `state_class` liefert, State-Mapping entsprechend erweitern.

---

## 25. Automatische Erkennung des Default Import Channels

Implementiere Funktion:

```ts
function selectDefaultImportChannel(channels: LiveVoiceChannel[]): LiveVoiceChannel | undefined
```

Regeln:

1. Nur Channels mit `hasAudio === true`.
2. Priorisiere `hasSubtitles === false`.
3. Priorisiere nicht-child (`isChild === false`).
4. Falls exakt ein Kandidat: auswählen.
5. Falls mehrere:
   - Name `Original Audio` case-insensitive als Hint.
6. Falls weiterhin nicht eindeutig:
   - kein automatischer Default
   - Benutzer muss Channel auswählen.

Nicht anhand einer festen ID arbeiten.

---

## 26. HTTP Client

Nutze eine im Companion-Modul erlaubte/übliche HTTP-Lösung gemäss aktuellem TypeScript-Template.

Anforderungen:

- Redirects folgen
- Timeout setzen, z. B. 10 Sekunden
- User-Agent kann normal gesetzt werden
- Response-Body als Text laden
- HTML parser verwenden
- keine Browser-Engine

Keine Abhängigkeit von Puppeteer/Playwright/Selenium.

---

## 27. WebSocket Client

Nutze die im aktuellen Companion-Modul-Ökosystem etablierte WebSocket-Library bzw. Node-WebSocket-API.

Anforderungen:

- `Origin: https://livevoice.io`
- URL:
  ```text
  <cable_url>?access_token=<urlencoded token>
  ```
- JSON-Nachrichten senden/empfangen
- Ping/Pong auf Anwendungsebene
- Close/Error Events
- Reconnect
- WebSocket sauber beim `destroy()` des Companion-Moduls schliessen

---

## 28. Companion API / aktueller Stand

Zum Stand 30.08.2026:

- Companion Connection Modules sind Plugin-Module.
- Neue Module sollen `@companion-module/base` verwenden.
- `@companion-module/base` 2.x ist aktuell.
- `@companion-module/tools` 3.x verlangt Node 22+ und Module API 2.x.
- Die offizielle `companion-module-base` README verweist auf TypeScript- und JavaScript-Templates.
- Bevorzugt das aktuelle offizielle **TypeScript Template** verwenden.
- Das Modul soll als importierbares `.tgz` paketierbar sein.

Nicht von alten Companion-3-Tutorials oder Module-API-v1-Strukturen ausgehen.

Aktuelle Referenzen:

```text
https://github.com/bitfocus/companion-module-base
https://bitfocus.github.io/companion-module-base/
https://github.com/bitfocus/companion
https://companion.free/for-developers/
```

Vor Implementierung die aktuellsten Template-Dateien/Manifest-Schema prüfen.

---

## 29. Empfohlene Projektstruktur

An aktuelle Companion-TypeScript-Template-Struktur anpassen, konzeptionell:

```text
companion-module-livevoice/
├─ companion/
│  ├─ manifest.json
│  ├─ HELP.md
│  └─ LICENSE
├─ src/
│  ├─ index.ts
│  ├─ config.ts
│  ├─ livevoice.ts
│  ├─ actions.ts
│  ├─ feedbacks.ts
│  ├─ variables.ts
│  ├─ presets.ts
│  └─ types.ts
├─ package.json
├─ tsconfig.json
└─ README.md
```

`livevoice.ts` soll die komplette LiveVoice-Protokolllogik kapseln:

- HTML Discovery
- Authentication
- WebSocket
- ActionCable
- Reconnect
- State parsing

Companion-spezifische Actions/Feedbacks sollen nicht mit Low-Level-Protokollcode vermischt werden.

---

## 30. Vorgeschlagene Klassenarchitektur

### `LiveVoiceClient`

```ts
class LiveVoiceClient extends EventEmitter {
	async connect(operatorUrl: string): Promise<void>
	async disconnect(): Promise<void>

	async startImport(channelId: number): Promise<void>
	async stopImport(channelId: number): Promise<void>

	getEvent(): LiveVoiceEventState | undefined
	getChannel(channelId: number): LiveVoiceChannel | undefined
}
```

Events:

```text
connected
disconnected
event
channelUpdated
statistics
error
```

Companion-Instance hört darauf und aktualisiert:

- Instance Status
- Variables
- Feedbacks
- Action choices

---

## 31. Testfälle

### Unit Tests: HTML Discovery

Fixture aus gespeichertem Operator-HTML erstellen, aber Secrets in Test-Fixtures durch Dummywerte ersetzen.

Test:

- `data-streaming-api-url` wird korrekt gelesen
- HTML Entities werden korrekt decodiert
- `data-streaming-api-headers` wird JSON-geparst
- `client-operator-token` gefunden
- fehlendes Attribut erzeugt definierten Fehler

### Unit Tests: ActionCable

Start:

Input:

```ts
channelId = 125145
```

Erwarteter JSON-String nach `JSON.parse()` aussen:

```json
{
	"command": "message",
	"identifier": "{\"channel\":\"V2Channel\"}",
	"data": "{\"channel_id\":125145,\"action\":\"start_importing\"}"
}
```

Stop entsprechend `stop_importing`.

### Unit Tests: State Parsing

Initial:

```json
{
	"id": 125145,
	"state": {
		"type": "offline"
	}
}
```

Erwartet:

```text
offline
```

Update:

```json
{
	"type": "channel_updated",
	"channel_id": 125145,
	"state_class": "active"
}
```

Erwartet:

```text
active
```

Markup fallback mit `stopImporting`:

```text
active
```

### Integrationstest

Mit echtem Operator-Link manuell:

1. Modul verbinden.
2. Eventname wird angezeigt.
3. Original Audio wird erkannt.
4. Companion Start Action.
5. LiveVoice Web UI zeigt Import aktiv.
6. Feedback wechselt auf active.
7. Import im Browser manuell stoppen.
8. Companion Feedback muss ohne eigenen Action-Aufruf auf inactive wechseln.
9. Start im Browser manuell.
10. Companion muss active erkennen.
11. Netzwerk kurz trennen.
12. Companion muss reconnecten und aktuellen Zustand neu ermitteln.

---

## 32. Akzeptanzkriterien Version 1

Das Modul gilt als funktionsfähig, wenn:

- [ ] Benutzer muss nur Operator URL konfigurieren.
- [ ] Operator-HTML wird ohne Browser geladen.
- [ ] Auth-Headers und Auth-URL werden automatisch extrahiert.
- [ ] Authenticate funktioniert.
- [ ] ActionCable verbindet.
- [ ] `V2Channel` wird subscribed.
- [ ] `init_event` wird verarbeitet.
- [ ] Eventname und Channels werden automatisch erkannt.
- [ ] Default-Import-Channel wird robust erkannt oder Benutzer kann ihn wählen.
- [ ] Start Import funktioniert.
- [ ] Stop Import funktioniert.
- [ ] Import-State wird vom LiveVoice-Server gelesen.
- [ ] Feedback `Import active` funktioniert.
- [ ] Feedback `Import inactive` funktioniert.
- [ ] Feedback funktioniert auch bei Änderung ausserhalb Companion.
- [ ] Listener-Statistik wird gelesen.
- [ ] Variablen werden aktualisiert.
- [ ] Ping/Pong funktioniert.
- [ ] Reconnect funktioniert.
- [ ] Keine Secrets in normalen Logs.
- [ ] `.tgz` lässt sich für Companion bauen/importieren.
- [ ] HELP.md dokumentiert Setup und Risiken.

---

## 33. Nicht-Ziele für Version 1

Nicht implementieren:

- Audio-Wiedergabe über Janus
- AI-Translation-Konfiguration
- Chat
- Untertitel-Ausgabe
- Event-Administration
- Channel-Erstellung/-Löschung
- Browser öffnen
- Selenium/Playwright
- PowerShell-Abhängigkeit

---

## 34. Bekannte Unsicherheiten

Diese Punkte sind noch nicht vollständig protokollseitig bestätigt:

1. **Stop-WebSocket-Frame**
   - Start wurde im HAR direkt aufgezeichnet.
   - `stop_importing` wurde nicht als separater Klick im bereitgestellten HAR aufgezeichnet.
   - Das nach Start gerenderte UI enthält `streaming-channel#stopImporting`, und die bisherige Gegenaktion ist `stop_importing`.
   - Implementieren, aber strukturiert kapseln und bei Problemen einen Stop-HAR capturen.

2. **Alle möglichen `state_class`-Werte**
   - Beobachtet:
     - initial `state.type = offline`
     - nach Start `state_class = active`
   - Weitere Zustände wie `inactive`, `connecting`, `error` etc. sind nicht vollständig erfasst.
   - Unbekannte States als `unknown` behandeln.

3. **Dynamische Companion Choices**
   - Prüfen, wie die aktuelle Companion Module API 2.x dynamische Dropdown-Choices nach Discovery aktualisiert.
   - Falls nicht sauber möglich, `Auto` als Default und Channel-ID/Name als Action-Option implementieren.

4. **HTML-Struktur kann sich ändern**
   - LiveVoice-Schnittstelle ist offenbar die interne Webclient-Schnittstelle, nicht eine dokumentierte öffentliche API.
   - Parser defensiv bauen.
   - Low-Level-Code kapseln.

---

## 35. Interne LiveVoice-Schnittstelle / Wartungsrisiko

Diese Integration basiert auf dem Verhalten des LiveVoice-Webclients und nicht auf einer bisher bekannten offiziellen öffentlichen LiveVoice-API.

Das bedeutet:

- LiveVoice kann HTML-Data-Attributes ändern.
- API-Key/Client-Header können sich ändern.
- ActionCable Message-Namen können sich ändern.
- Channel-Markup kann sich ändern.

Deshalb:

- keine Werte unnötig hardcoden
- Discovery immer aus Operator-Seite
- Protokolllogik in einer Klasse kapseln
- gute Fehlermeldungen
- Debug-Modus
- Tests mit HTML-/WebSocket-Fixtures

---

## 36. Bereits funktionierender Proof of Concept

Die bisherige PowerShell-Lösung hat folgende Schritte erfolgreich geschafft:

1. Authenticate mit:
   - API Key
   - Client Identifier
   - Operator Token
   - Webclient-Headers
2. Erfolgreiche Antwort:
   ```text
   Authentifizierung erfolgreich.
   ```
3. WebSocket-Verbindung zu ActionCable.
4. `V2Channel` Subscribe.
5. `start_importing` senden.

Daraus ist bestätigt, dass die Browser-Automation nicht nötig ist.

---

## 37. Referenzdaten aus dem untersuchten Event

Nur als Debug-/Fixture-Referenz, **nicht hardcoden**:

```yaml
event:
  id: 64447
  name: 'ICF BL Celebration'
  join_code: '888154'
  listener_share_url: 'https://livevoice.io/listen/888154'

operator:
  token: 'jPrB9A76r6v-kGqQob5BES15qEJBbqgzc6s24EEDxck'

observed_web_client:
  api_key: '2yoWWe9nbAYpalZG8iDEFGIcC5tHJ2'
  client_identifier: 'ba6a0f7e-f78d-4cf9-894c-1828f3d743cb'
  client_product: 'io.livevoice.client.web'
  client_role: 'operator'
  client_os: 'Windows'
  client_os_version: '10.0'
  client_browser: 'Microsoft Edge'
  client_browser_version: '152'
  client_hardware_model: 'Unknown'
  client_preferred_locale: 'de'

channels:
  - id: 125145
    name: 'Original Audio'
    has_audio: true
    has_subtitles: false

  - id: 125147
    name: 'English'
    has_audio: true
    has_subtitles: true

  - id: 126435
    name: 'Français'
    has_audio: true
    has_subtitles: true

  - id: 126008
    name: 'Українська'
    has_audio: true
    has_subtitles: true
```

Nochmals: Diese Werte sind Fixture-/Troubleshooting-Daten und dürfen nicht zur generischen Modulkonfiguration werden.

---

## 38. Claude Code Arbeitsauftrag

Arbeite in dieser Reihenfolge:

### Schritt 1 - Scaffold

- Aktuelles offizielles Bitfocus Companion TypeScript Module Template verwenden.
- Gegen aktuelle `@companion-module/base` 2.x API entwickeln.
- Aktuelle Build-/Package-Tools verwenden.
- Projekt so einrichten, dass `yarn package` oder der vom aktuellen Template vorgegebene Package-Befehl ein importierbares `.tgz` erzeugt.

### Schritt 2 - `LiveVoiceClient`

Implementiere zuerst vollständig unabhängig von Companion:

- `discover(operatorUrl)`
- `authenticate()`
- `connectCable()`
- `subscribeV2Channel()`
- `startImport(channelId)`
- `stopImport(channelId)`
- Reconnect
- Ping/Pong
- Message Parser
- Event-/Channel-State

Dazu Unit Tests.

### Schritt 3 - Companion Integration

Implementiere:

- Config
- Instance status
- Variables
- Actions
- Feedbacks
- Presets

### Schritt 4 - Feedback-Verifikation

Der lokale Importstatus darf niemals nur aufgrund von `startImport()`/`stopImport()` gesetzt werden.

Erst eine Servernachricht (`channel_updated`, `init_event` oder eindeutig ableitbares Markup) darf den State ändern.

### Schritt 5 - Packaging

- Lint
- Tests
- Build
- `.tgz`
- HELP.md
- README.md

### Schritt 6 - Keine unnötigen Features

Keine Audio-/Janus-Implementierung, kein Browser, kein Chat.

---

## 39. Gewünschte Coding-Qualität

- TypeScript strict
- kleine klar getrennte Module
- keine `any`, ausser eine externe untypisierte Payload wird direkt validiert
- Runtime-Validation für LiveVoice-Payloads bevorzugt
- keine Token in Logs
- AbortController/Timeouts für HTTP
- definierter Reconnect
- saubere Dispose-/Destroy-Logik
- Tests für Protokoll-Encoding
- defensive Behandlung unbekannter LiveVoice-Nachrichten
- keine Spekulation über unbekannte States

---

## 40. Erste Implementation, die Claude Code liefern soll

Als erster Meilenstein soll Claude Code Folgendes liefern:

```text
1. Modul startet in Companion.
2. Config: Operator URL.
3. GET Operator URL.
4. Extrahiert data-streaming-api-url + data-streaming-api-headers.
5. Authentifiziert.
6. Verbindet ActionCable.
7. Subscribed V2Channel.
8. Loggt ohne Secrets:
   Event: <name>
   Channel: <name> (<id>)
9. Companion Variables:
   event_name
   connection_status
   import_channel_name
   import_channel_id
   import_state
10. Actions:
    Start Import
    Stop Import
11. Feedback:
    Import active
12. Reconnect.
```

Erst wenn dieser Meilenstein stabil funktioniert, Toggle, Presets und weitere Feedbacks ergänzen.

---

## 41. Referenz: Start-Nachricht bytegenau logisch

Das ActionCable-Encoding ist ein häufiger Fehlerpunkt.

Richtig:

```ts
const identifier = JSON.stringify({
	channel: 'V2Channel',
})

const data = JSON.stringify({
	channel_id: 125145,
	action: 'start_importing',
})

const frame = JSON.stringify({
	command: 'message',
	identifier,
	data,
})
```

Resultat:

```json
{
	"command": "message",
	"identifier": "{\"channel\":\"V2Channel\"}",
	"data": "{\"channel_id\":125145,\"action\":\"start_importing\"}"
}
```

Nicht so:

```json
{
	"command": "message",
	"identifier": {
		"channel": "V2Channel"
	},
	"data": {
		"channel_id": 125145,
		"action": "start_importing"
	}
}
```

ActionCable erwartet hier die String-Encodierung wie im Webclient.

---

## 42. Referenz: Stop-Nachricht

```ts
const data = JSON.stringify({
	channel_id: 125145,
	action: 'stop_importing',
})
```

Resultat:

```json
{
	"command": "message",
	"identifier": "{\"channel\":\"V2Channel\"}",
	"data": "{\"channel_id\":125145,\"action\":\"stop_importing\"}"
}
```

---

## 43. Quellenbasis dieser Doku

Diese Spezifikation basiert auf:

1. Dem bereitgestellten LiveVoice Operator-Link.
2. Einer vom Benutzer aufgenommenen HAR-Datei der LiveVoice-Operator-Session.
3. Erfolgreichen PowerShell-Proof-of-Concept-Tests gegen den Auth-Endpunkt.
4. Aktueller Bitfocus-Companion-Moduldokumentation / GitHub-Repositorys zum Stand 30.08.2026.

Wichtig: LiveVoice selbst dokumentiert die hier verwendeten internen Webclient-Endpunkte/ActionCable-Aktionen soweit in diesem Projekt bekannt nicht als stabile öffentliche API. Entsprechend muss das Modul defensiv implementiert werden.
