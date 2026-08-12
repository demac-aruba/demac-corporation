# Booking Copilot CRM / Property Location Hotfix

The Booking Copilot now resolves location context from registered CRM customers and service properties before asking an operator to repeat a DEMAC sector.

Acceptance example:

- Spoken/text request: `el cliente Christian Márquez de guayaca 217 tiene cuatro aires acondicionados ...`
- Customer: `Christian Márquez`
- Registered property: `Wayaca Residence 217`
- DEMAC sector inherited from property: `Oranjestad`
- Work scope remains independently interpreted by Booking Copilot.

The location resolver also tolerates the common speech-recognition variants `Guayaca`, `Huayaca` and `Wayaka` for `Wayaca`, and can fall back to Aruba Address Intelligence when a registered property is not identified.

This changes interpretation only. Booking capacity, route, lunch, support, offer revalidation and final scheduling authority remain deterministic.
