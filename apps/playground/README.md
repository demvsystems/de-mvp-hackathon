# PWX Szenario-Paket (v1.0)

## Zweck
Dieses Paket beschreibt die Weiterentwicklung von **PWX** als kontextuellen Agenten in **PW** sowie fuenf vielschichtige Test-Szenarien fuer Cluster-Erkennung, Priorisierung und Folgeaktionen.

## Enthaltene Dateien

### Kernmodell
- `pwx_agent_development.json`
  - Zielbild, Entscheidungslogik, Action-Modes, Prozessketten, Rollenperspektiven, Anforderungen, Roadmap.

### Szenarien (Einzeldokumente)
- `scn_01_bipro_datenverlust.json`
- `scn_02_exchange_blockade.json`
- `scn_03_provision_einwand.json`
- `scn_04_mva_chancen_radar.json`
- `scn_05_onboarding_abwaertsspirale.json`

### Sammeldatei und Analysen
- `pwx_signal_scenarios.json`
  - Alle 5 Szenarien in einer Datei mit einheitlichem Schema.
- `pwx_signal_scenarios_alignment.json`
  - Deckungs-/Komplexitaetsanalyse gegen `pwx_agent_development.json`.
- `pwx_examples_fit_report.json`
  - Fit-Bewertung zu bestehenden Beispielquellen (Intercom, Upvoty, Jira, Slack).

## Empfohlene Lesereihenfolge
1. `pwx_agent_development.json`
2. `scn_01_bipro_datenverlust.json` bis `scn_05_onboarding_abwaertsspirale.json`
3. `pwx_signal_scenarios_alignment.json`
4. `pwx_examples_fit_report.json`

## Kurzfazit
- Die 5 Szenarien sind bewusst **vielschichtiger** als reine technische Dummydaten.
- Zusammen mit dem PWX-Kernmodell bilden sie eine belastbare Grundlage fuer Demo-Szenarien, Ticketableitung und Produktentscheidungen.

## Version
- Paketstand: `v1.0`
- Sprache: `de`
