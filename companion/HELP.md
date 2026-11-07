## LiveVoice Remote

Steuert [LiveVoice](https://livevoice.io) über die offizielle **LiveVoice Server API v2**: Audio-Import und
AI-Übersetzung pro Channel starten/stoppen, Channel-Status und Teilnehmerzahlen als Feedbacks und Variablen.

«LiveVoice» und das LiveVoice-Logo sind Marken der LiveVoice GmbH. Dieses Projekt ist ein unabhängiges
Community-Modul, steht in keiner Verbindung zu LiveVoice und verwendet weder deren Logo noch deren Wortmarke als
Produktname. Der API-Key wird ausschliesslich lokal in der Companion-Instanz gespeichert; es werden keine
Audio-Daten, Event-Daten oder Zugangsdaten an Dritte übertragen.

### Voraussetzungen

- LiveVoice-Konto mit freigeschalteter **Server-API** (Plan PLUS, Freischaltung über den LiveVoice-Support).
  Die API ist laut LiveVoice noch **BETA** - Felder können sich bis Ende 2026 ändern.
- Ein **API-Key**, erstellt im LiveVoice-Konto unter der API-Schlüsselverwaltung.
- Ausgehender HTTPS-Zugriff von Companion auf `livevoice.io`.

### Konfiguration

- **API-Key** — Server-API-Key des Kontos (maskiertes Feld, wird nie geloggt).
- **Event** — nach der ersten Verbindung ein Dropdown mit allen Events des Kontos. `Auto` funktioniert nur, wenn
  das Konto genau **ein** aktives Event hat; sonst meldet die Verbindung "bitte Event wählen".
- **Bevorzugter Import-Channel** — `Auto / Quellkanal` oder ein konkreter Channel (Dropdown nach erster Verbindung).
- **Status-Abfrage alle … Sekunden** — Standard 30 s, Minimum 15 s.
- **Teilnehmerzahl alle … Sekunden** — Standard 120 s, `0` schaltet die Abfrage aus.
- **Webhook empfangen** + **Webhook-Secret** — optional, siehe unten.
- **Debug-Logging** — Statuswechsel, Webhooks und Request-Budget auf Debug-Level.

**Einrichtung Schritt für Schritt** (Companion lädt die Auswahllisten nur beim Öffnen des Dialogs neu):

1. API-Key eintragen → **Speichern**.
2. Dialog schliessen und neu öffnen → im Dropdown **Event** das gewünschte Event wählen → **Speichern**.
3. Dialog erneut öffnen → **Bevorzugter Import-Channel** wählen (oder auf `Auto / Quellkanal` lassen) → **Speichern**.

Vor dem ersten Verbinden enthalten beide Dropdowns nur `Auto` mit einem Hinweis; eine ID kann auch direkt eingetippt
werden.

### API-Limits (wichtig)

LiveVoice erlaubt **60 Requests pro Minute und 300 pro Stunde pro IP-Adresse** - auch abgelehnte Requests zählen.
Das Modul teilt sich das Budget selbst ein:

| Quelle                                 | Requests/Stunde (Standard) |
| -------------------------------------- | -------------------------- |
| Status-Abfrage alle 30 s               | 120                        |
| Teilnehmerzahl alle 120 s (2 Abfragen) | 60                         |
| Reserve für Button-Aktionen            | mind. 40                   |

Die Abfragen pausieren automatisch, bevor die Reserve angetastet wird; Aktionen gehen immer vor. Nach einem
`429` sendet das Modul bis zur nächsten vollen Minute gar nichts. Die Variable `api_requests_last_hour` zeigt den
aktuellen Verbrauch. **Achtung:** Laufen mehrere Companion-Verbindungen oder andere API-Werkzeuge hinter derselben
öffentlichen IP, teilen sie sich das Limit - dann Intervalle entsprechend erhöhen.

### Webhook (optional, für sofortige Statuswechsel)

LiveVoice kann Statuswechsel (`channel_state_changed`) aktiv an Companion melden. Das funktioniert nur, wenn
Companion aus dem Internet per HTTPS erreichbar ist (Reverse-Proxy, Tunnel o.ä.).

1. Eigenes zufälliges Secret mit 32-255 Zeichen erzeugen und in **Webhook-Secret** eintragen, **Webhook
   empfangen** aktivieren.
2. Endpunkt: `https://<öffentliche-Companion-Adresse>/instance/<Verbindungsname>/webhook` (wird im
   Konfigurationsdialog angezeigt).
3. Webhook einmalig bei LiveVoice anlegen: `POST https://livevoice.io/api/v2/webhooks` mit
   `{"event": "channel_state_changed", "url": "<Endpunkt>", "secret": "<Secret>"}`.

Jeder Webhook wird per HMAC-SHA256-Signatur geprüft; Requests mit falscher Signatur oder älter als 5 Minuten
werden abgelehnt, doppelte Zustellungen ignoriert. Mit aktivem Webhook läuft die Status-Abfrage nur noch alle
120 s als Abgleich.

### Automatische Channel-Erkennung

`Auto / Quellkanal` nimmt den in der Konfiguration bevorzugten Channel. Steht dieser auf `Auto`, sucht das Modul
unter den Channels **ohne** AI-Übersetzung (bevorzugt solche mit Audio-Eingang): Ist es genau einer, wird er
verwendet; bei mehreren gewinnt der Channel, den die AI-Channels als Quelle nutzen, danach der Name
"Original Audio". Bleibt die Wahl mehrdeutig, wird **kein** Channel gewählt - dann den Channel explizit angeben.

### Aktionen

- **Import starten** / **Import stoppen** / **Import umschalten** — Channel-Dropdown (`Auto / Quellkanal` oder
  konkret). Umschalten entscheidet anhand des tatsächlichen Serverstatus und verweigert bei unbekanntem Status.
- **AI-Übersetzung starten** / **stoppen** / **umschalten** — nur für Channels mit aktivierter AI-Übersetzung
  (Start/Stop-Modus "manuell" in LiveVoice). `not_configured` heisst: AI nicht eingerichtet oder keine
  AI-Minuten bzw. Zahlungsmethode mehr.
- **Ursprungssprache setzen** — Quell-Channel + Sprache (alle 70 von LiveVoice unterstützten Sprachen) + Option
  "AI-Channel in Ursprungssprache ausblenden" (Standard an). Details siehe unten.
- **Stimme setzen (alle AI-Channels)** / **Stimme umschalten männlich/weiblich** — setzt die Stimme der
  Sprachausgabe für alle AI-Channels des Events auf einmal (männlich, weiblich oder Premium; Premium wird von
  LiveVoice separat verrechnet). Channels ohne Sprachausgabe und bereits passende werden übersprungen
  (1 Request + 1 pro geändertem Channel). Umschalten wechselt männlich ↔ weiblich (Premium bleibt Premium) und
  verweigert bei gemischten Stimmen.
- **Status jetzt abfragen** — sofortiger Abgleich (1 Request).

Ist ein Channel bereits im Zielzustand (`already_in_state`), wird das nicht als Fehler gewertet. Nach jeder
Aktion lädt das Modul den Channel-Status gezielt nach, statt ihn aus dem Befehl abzuleiten.

### Ursprungssprache umstellen

Spricht z.B. ein Gast Englisch statt Deutsch, stellt die Aktion **Ursprungssprache setzen** in einem Schritt um:

1. Quell-Channel: gesprochene Sprache = neue Sprache (inkl. Sprache der AI-Untertitel; ob diese an oder aus sind,
   bleibt unverändert).
2. Alle AI-Channels, die aus diesem Channel übersetzen: Quellsprache = neue Sprache.
3. Der AI-Channel, dessen Zielsprache der neuen Ursprungssprache entspricht (z.B. "English" bei englischem
   O-Ton), wird für Teilnehmende **ausgeblendet** (App, Web, iFrame) - wer Englisch hören will, hört direkt das
   Original. Beim Zurückstellen wird er wieder eingeblendet. Channels, die aus anderen Gründen ausgeblendet sind,
   bleiben ausgeblendet.

Verbraucht 1 Request plus 1 pro geändertem Channel (bei 1 Quelle + 3 AI-Channels also 5). Bereits passende
Channels werden übersprungen. Hinweis: Ein ausgeblendeter AI-Channel übersetzt technisch weiter, falls er auf
Start/Stop-Modus "source" steht.

### Feedbacks

- **Import ist aktiv** (`importing_source`/`importing_channel`) / **Import ist inaktiv** (offline, Sprecher oder
  AI) / **Channel ist offline** / **Import-Status unbekannt** (noch keine Daten oder API-Fehler).
- **AI-Übersetzung läuft** (`ai_translating`).
- **Ursprungssprache ist …** — Quell-Channel hat genau diese gesprochene Sprache.
- **Stimme ist …** — alle AI-Channels mit Sprachausgabe verwenden diese Stimme.
- **Channel-Zustand ist …** — Vergleich mit dem rohen LiveVoice-Zustand (`offline`, `speaking`,
  `importing_source`, `importing_channel`, `ai_translating`).
- **LiveVoice verbunden** — letzte API-Abfrage erfolgreich.
- **Teilnehmerzahl vergleichen** — Channel + Operator (`=`, `>`, `<`, `>=`, `<=`) + Wert.

Alle Zustände kommen vom LiveVoice-Server; Änderungen im LiveVoice-Web-UI werden also ebenfalls angezeigt
(mit Polling-Verzögerung bzw. sofort per Webhook).

### Variablen

`connection_status`, `event_name`, `event_id`, `join_code`, `participant_url`, `event_listener_count`,
`import_channel_name`, `import_channel_id`, `import_state` (`active`/`inactive`/`offline`/`unknown`),
`channel_state` (roher LiveVoice-Zustand), `source_language`, `ai_voice` (Stimme oder `gemischt`), `listener_count`, `api_requests_last_hour`.

### Presets

- **LiveVoice Start Import** / **LiveVoice Stop Import** / **LiveVoice Start & Stop** — alle auf
  `Auto / Quellkanal`, mit den Key-Grafiken aus [assets/brand/keys/](../assets/brand/keys/README-Keys.md).
- **LiveVoice AI-Übersetzung** — pro AI-Channel ein Umschalt-Button (erscheint, sobald das Event geladen ist).
- **LiveVoice Stimme** — "Stimme männlich" / "Stimme weiblich", leuchtet bei aktiver Stimme.
- **LiveVoice Ursprungssprache** — "O-Ton DE/EN/FR/IT/ES", leuchtet bei aktiver Sprache. Weitere Sprachen über
  die Aktion.

### Bekannte Einschränkung (Companion, bitfocus/companion#4410)

Companion übernimmt die Feedbacks eines `layered`-Presets beim Ziehen auf einen Button nicht automatisch
(Elemente und Steps schon) - [bitfocus/companion#4410](https://github.com/bitfocus/companion/issues/4410).
Workaround für "Start & Stop": nach dem Ziehen einmalig drei Feedbacks ergänzen:

- `Import ist aktiv` → `Hintergrund (idle)` Enabled aus + `Hintergrund (aktiv)` Enabled an
- `Import ist inaktiv` → `Hintergrund (aktiv)` Enabled aus + `Hintergrund (idle)` Enabled an + `Haupttext` Farbe Weiss
- `Import-Status unbekannt` → `Hintergrund (idle)` Enabled aus + `Hintergrund (unbekannt)` Enabled an

Für AI- und Sprach-Buttons analog: `AI-Übersetzung läuft` bzw. `Ursprungssprache ist …` → `Hintergrund (idle)`
aus + `Hintergrund (aktiv)` an.

### Umstieg von 0.3.x

Bis 0.3.x lief das Modul über die interne Webclient-Schnittstelle (Operator-Link). Ab 0.4.0 entfällt der
Operator-Link: nach dem Update **API-Key eintragen und Event wählen**. Actions, Feedbacks und Presets behalten
ihre IDs, bestehende Buttons funktionieren weiter.
