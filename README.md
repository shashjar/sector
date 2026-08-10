# Sector

Sector is an application that provides airspace, live traffic, radio frequency, and weather information on one map. It's a tool built for pilots, controllers, flight instructors, and aviation enthusiasts.

---

## The problem

Aviation information is spread across many different sources, e.g. FlightAware for live traffic, LiveATC for the radio, and aviationweather.gov for METARs. Additionally, student pilots can experience difficulty parsing all that information.

## The insight

General speech models mangle ATC audio, and they fail hardest on exactly the token that matters. Callsigns are rare, spelled-out, phonetic sequences delivered fast over a compressed channel.

**But the callsign isn't unknown. It's on screen.** ADS-B tells you exactly which aircraft are near the field right now. The airport database gives you the runways. Every one of those is a hard constraint on what a controller or pilot could possibly be saying.

## How it works

**Audio** arrives as an MP3 stream. An `AudioWorklet` splits the continuous feed into individual transmissions and passes the audio through to the speakers unchanged, so you still hear the frequency while it is being segmented.

**Transcription** is deliberately unassisted — the speech model gets audio and nothing else, no vocabulary hints.

**Grounding** takes that text plus the aircraft actually in range and returns a typed transmission: speaker, callsign, corrected text, and structured instructions. Whatever callsign it returns is then checked against the candidate set server-side. Anything outside the set is rejected and the card renders as *Unmatched*.

**Traffic** polls ADS-B for the viewport and dead-reckons positions between polls, so targets glide instead of teleporting.

**Weather** comes from NOAA already decoded — no METAR parser — and is shown against runway alignment, because "favors runway 30" beats `30011KT` for anyone not already fluent.

## Running it

```bash
npm install
npm run dev
```

Needs `AI_GATEWAY_API_KEY` in `.env.local` for transcription and grounding. Everything else — traffic, weather, charts, audio — works without a key.

```bash
npm test          # vitest
npm run lint
npm run build
npm run build:airspace   # regenerate airport/runway data from OurAirports
```

Models are swappable by environment variable through the AI Gateway, since one key reaches every provider:

```
TRANSCRIBE_MODEL=openai/gpt-4o-transcribe
GROUND_MODEL=anthropic/claude-haiku-4.5
```

## Layout

```
app/api/          route handlers — stream proxy, traffic, weather, transcribe, ground
components/scope/ the map, and the hooks that feed it
components/shell/ weather bar, transcript panel, tuner bar
lib/              domain logic, all of it unit-tested
public/worklets/  the audio segmenter
scripts/          airport data build
```

## Stack

Next.js 16 · React 19 · MapLibre GL · AI SDK 7 through Vercel AI Gateway · Turf · Tailwind · Vitest

Data: [adsb.lol](https://adsb.lol) (ODbL) · [NOAA Aviation Weather Center](https://aviationweather.gov) · [OurAirports](https://ourairports.com) (public domain) · FAA Aeronautical Information Services · Esri ArcGIS Online · [LiveATC.net](https://liveatc.net)
