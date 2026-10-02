# CLAUDE.md — moonrace.lol

Context and working guide for Claude Code. Read this before making changes.

## What this is

**moonrace.lol** is a free browser game: pilot a rocket 384,400 km from Earth to the Moon, dodging weather balloons, satellites, space junk, and asteroids while managing fuel. Runs last about two minutes if you survive. Every result is "X% of the way to the Moon," which is the shareable unit of the whole product.

**Product goal:** go viral without an existing audience. The game itself has to do the marketing, so features are judged by whether they make people (1) play again and (2) share. Realism got people to try it; _feeling_ is what keeps them. When in doubt, prioritize game feel, humor, and shareability over more realism or more content.

**Tone:** cinematic and realistic visuals, but the voice is funny (".lol"). Mission control is dry, affectionate, slightly alarmed. Never mean to the player.

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript (strict)
- Three.js 0.186 with `three/addons` post-processing (RenderPass, UnrealBloomPass, OutputPass)
- Web Audio API for all sound (synthesized, no audio files except optional voice clips)
- Upstash Redis for leaderboards (falls back to in-memory store in dev)
- `next/og` for share images
- Deploy target: Vercel

## Commands

```bash
npm run dev            # local dev at :3000 (Strict Mode mounts the game twice; slow first load is expected)
npm run build          # production build; must pass before considering work done
npm run typecheck      # tsc --noEmit
npm run voice:script   # regenerate docs/voice-script.csv from game/lines.ts (Node 22+; on older Node: npx tsx scripts/voice-script.ts)
npm run flags          # copy country flags to public/flags and regenerate lib/countries.ts
```

Env vars (see `.env.example`): `RUN_SECRET` (required in production, signs run tokens), `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `NEXT_PUBLIC_SITE_URL`.

## Architecture

```
app/
  page.tsx                  renders GameLoader (client-only game)
  layout.tsx                metadata, viewport, Google Fonts <link>
  globals.css               all styles: HUD, screens, pages
  leaderboard/page.tsx      server component, reads store directly
  share/page.tsx            landing page for shared results; OG metadata
  api/run/start/route.ts    POST → { token, seed, day }
  api/run/finish/route.ts   POST result → validates → { rank, total, firstToMoon }
  api/stats/route.ts        GET today's top 10, run count, first-to-Moon
  api/og/route.tsx          1200x630 share image from query params
components/
  GameLoader.tsx            dynamic(import GameClient, { ssr: false })
  GameClient.tsx            React shell: HUD markup + refs, title/over screens,
                            run tickets, score submission, sharing, mute/voice
  SurfaceUI.tsx             landing-site UI: walk spots, plant flag / place panel sheet
game/                       FRAMEWORK-FREE ENGINE (no React imports, ever)
  Game.ts                   main class: loop, states, input, spawning, collisions,
                            near misses, camera, HUD writes, end-of-run result
  constants.ts              distances, speeds, fuel, milestones, kmAt(), maxUnitsIn()
                            (shared with server validation)
  lines.ts                  every mission control line (data only)
  moonAtlas.ts              observatory landmarks (data only) + moonPoint(lat, lon)
  observatory.ts            Observatory: orbit/zoom camera round the Moon, landmark markers
  surface/LandingSite.ts    the landing zone up close: descent, walk spots, plantings, dust
  surface/terrain.ts        deterministic metre-scale terrain, craters, rocks, regolith textures
  surface/plantings.ts      Planting type, flag/panel meshes, drawPanel() (shared with the UI)
  deflector.ts              Deflector: charge, cooldown, aim-assist lock, bolts, reticle/pips HUD
  chatter.ts                Chatter class: priority, cooldown, subtitles, Quindar, voice
  rng.ts                    seeded Rng (gameplay) + fx (visual-only Math.random)
  views.ts                  ViewRenderer: main view + picture-in-picture, both via OutputPass
  cockpit/Cockpit.ts        cabin scene, onboard camera, plush zero-g indicator, cabin lights
  cockpit/pilot.ts          astronaut rig: two-bone IK arms, head tracking, gestures
  cockpit/instruments.ts    canvas screens (flight data, proximity radar, fuel), ~12 Hz
  noise.ts                  value noise / fbm used by procedural textures
  audio/AudioEngine.ts      engine rumble, wind, space pad, all SFX, master lowpass
  audio/Voice.ts            recorded clips via radio filter; speechSynthesis fallback
  world/sky.ts              sky gradient shader, stars, SUN_DIR
  world/earth.ts            Earth sphere, cloud layer, atmosphere glow
  world/moon.ts             Moon with custom lit shader + height-map relief (MoonSurface)
  world/rocket.ts           Saturn-style rocket + exhaust; setThrust(); EXTERIOR_LAYER
  world/launchpad.ts        LaunchPad: own scene (coast, tower, swing arms, steam/smoke),
                            launch timeline and its three camera shots
  world/obstacles.ts        ObjectFactory (obstacles, fuel, clouds), lane bounds
  world/textures.ts         procedural textures (Earth, Moon, rocket paint…); moonSurfaceJob()
                            builds the real-geography Moon in slices
lib/
  daily.ts                  dayKey() (UTC), daySeed()
  token.ts                  HMAC-signed run tokens (node:crypto)
  store.ts                  Store interface; RedisStore + MemoryStore
  validate.ts               checkResult(), cleanName()
  share.ts                  shareQuery() / parseShare()
  site.ts                   SiteStore interface + LocalSiteStore; shrinkLogo(), cleanPlantingName()
  countries.ts              generated by `npm run flags` (code → name)
public/flags/               country flag SVGs (flag-icons, MIT), copied by `npm run flags`
public/voice/               <lineId>.mp3 files + manifest.json
docs/voice-script.csv       recording checklist (generated)
scripts/voice-script.ts     exporter (run with node --experimental-strip-types)
```

### Data flow

1. `GameClient` mounts, creates `new Game(container, hudRefs, events)` and prefetches a run ticket from `/api/run/start`.
2. On Launch (a user gesture, which matters for audio), `GameClient` calls `game.start(seed)` with the ticket's seed, then prefetches the next ticket.
3. `Game` runs its own `requestAnimationFrame` loop and writes the HUD directly to DOM elements in `HudRefs`.
4. `Game` emits `onStateChange(state)` and `onGameOver(RunResult)`. React renders menus only in `title` and `over` states.
5. `GameClient` posts the result with the token to `/api/run/finish` and shows rank.

### Game states

`title` (camera orbits rocket; ↔ `observe`, the lunar observatory) → `count` (launch pad: 3-2-1, ignition, liftoff, ascent; ~6 s) → `play` → `ending` (explosion or sputter, ~1–1.8 s) → `over` (end screen) → back to `count` on relaunch.

### Lunar observatory (`observe`)

- "Look at the Moon" on the title screen → `game.observe()` → state `observe` (title ↔ observe only; Esc or Back returns). Drag / arrows orbit, wheel / pinch / +- zoom, minimum altitude ~600 km (look, don't land). Landmark chips and markers call `focusLandmark(id)`; "Low sun / Full Moon" calls `setMoonSun()`.
- The Moon texture has real geography: maria and named craters at their true selenographic positions (`MARIA`/`CRATERS` in `textures.ts`, landmarks in `moonAtlas.ts`; u = 0.5 + lon/360). Relief comes from a half-float height map (world units) that the shader differentiates on the sphere's east/north frame.
- The 2048×1024 surface is built by `moonSurfaceJob` in ~6 ms slices while the title screen idles, then also replaces the 1024 in-flight Moon. If the player opens the observatory first, it finishes synchronously (GameClient shows "Pointing the telescope…").
- Landmark facts are real; check them before editing. Quips follow the mission-control voice.

### Landing site (`landing` → `surface`)

- Reaching the Moon now lands you instead of showing the end screen: `finish()` still emits `onGameOver` (score submitted, "Mission report" shows the result card), then `enterSite()` → state `landing` (scripted descent, skippable) → `surface` (first person).
- One spot only: the Moonrace landing zone in Mare Marginis (13° N, 80° E, on the eastern limb), so Earth sits ~9.5° above the western horizon. It's also a landmark in the observatory. Site layout in `LandingSite.ts` (metres, x east, z south, lander at origin): flag field, crater rim, look-back spot.
- Realism notes: real Moon radius for the horizon drop, hard low sun with 4096 shadow maps (lander on `EXTERIOR_LAYER`, so the shadow camera enables it), almost no fill light, ballistic dust (no billowing, 1.62 m/s²), loping walk, bootprints, faint stars, suit breathing as the only sound.
- Plantings: one per landing (unlimited on test runs). Flags use country SVGs; panels use `drawPanel()` with an optional logo (shrunk to 256 px) and corner flag. Each planting gets a fixed golden-spiral slot by creation order; the walker goes to the slot and plants it in front of them.
- Close-up view: tap a flag or panel (a tap is < 8 px and < 450 ms; anything else is a look-drag) or its name label. `LandingSite.focus(id)` walks to a stand point in front of it, kneels for panels, and zooms so the item's width and height fit the screen (higher on portrait, left of centre on wide screens, so the card doesn't cover it). While focused, the face (flag cloth / panel plate, materials tagged `userData.face`) switches to an evenly lit reading mode via `setMatte()` (no sun glare or wash-out at any angle) and bloom drops to 0.04; stepping back restores the sunlit finish. The game reports canvas taps through `onFocusPlanting`; the card (`FocusCard` in `SurfaceUI`) offers Previous / Next through the field and Step back (Esc).
- Storage: `SiteStore` in `lib/site.ts`. **Currently `LocalSiteStore` (device localStorage) for testing.** To go shared, implement a cloud store (list from an API, logo upload to blob storage, name filtering, image moderation) and swap it in `GameClient` (`storeRef`); the game only sees `setPlantings()` / `plant()`.

### Test flights

`/?test=surface` adds "Go to landing site" on the title screen (straight to the descent). `/?test=moon` (starts at 85%) or `/?test=<percent>`: launch skips to the cut, `t` starts at top speed, earlier milestones are skipped, collisions are off, and the result is never submitted, shared or saved as a best. Always on in `npm run dev`; in production only when built with `NEXT_PUBLIC_TEST_FLIGHTS=1`.

### Launch, cabin and picture-in-picture

- **Launch (`count`):** rendered from `LaunchPad`'s own scene. Timeline in `world/launchpad.ts`: wide shot → ignition at 1.5 s (engine close-up, steam out of the flame trench) → liftoff at 3.0 s ("Liftoff" + launch chatter) → long-lens tracking shot with pitch-over → whiteout cut to `play` at 6.0 s. Mission time `t` only starts in `play`, so validation is unaffected. A player's first launch plays in full; later ones skip with tap / Space / Enter / Esc.
- **Cabin:** `Cockpit` is drawn over the world after a depth clear, so the window shows the real flight. The outside camera rides the ship (`placeWorldCamera`); the rocket hull is on `EXTERIOR_LAYER` so it doesn't block that camera. The pilot holds the stick (follows steering) and throttle, tracks the nearest incoming obstacle, flinches on near misses and gestures on events (pre-launch checks, taps the fuel screen on low fuel, thumbs up on pickups, waves at the ISS, points at the plush at the Kármán line, shrugs when out of fuel, celebrates at the Moon). The plush Moon hangs under gravity (toward the tail on the pad) and floats once in space. The name tag shows the callsign.
- **PiP:** whichever view isn't on the big screen renders into `HudRefs.pip`'s rectangle (scissored viewport, no bloom). Click the PiP or press C to swap; stored as `moonrace-view` (`chase` | `cabin`). On a crash the cabin feed shows "Signal lost" and the outside view takes the big screen. Keep the `.pip` element free of CSS transforms: its rect is measured on resize and on entering `count`.

## Hard rules

1. **Never set React state from the game loop.** HUD updates go through `HudRefs` and `setText()` (which caches to avoid DOM churn). React state changes only on state transitions and game over.
2. **`game/` stays framework-free.** It must remain bundleable on its own (for Poki/CrazyGames builds). No React, no Next imports, no `@/lib` server code.
3. **Gameplay randomness uses the seeded `Rng`; visual randomness uses `fx` or `Math.random`.** Anything affecting obstacle/fuel placement or spawn timing must go through `this.rng` so the daily run stays consistent. Clouds, explosions, flicker, and chatter selection use non-seeded randomness. Don't add or remove `rng` calls casually: it changes everyone's daily layout.
4. **`game/constants.ts` is shared with the server.** If you change speeds, ramp, boost, or distance mapping, `maxUnitsIn()` must still be a true upper bound, or legitimate scores get rejected.
5. **Voice file names derive from line position** (`<key>_<index+1>.mp3`). Append new lines to the end of a pool; never reorder or delete recorded lines. Regenerate the CSV after edits.
6. **Color management:** modern Three.js converts sRGB at output via `OutputPass`. Custom `ShaderMaterial`s output linear color, so authored sRGB-ish colors are wrapped in `pow(c, vec3(2.2))` (see sky and atmosphere). Canvas color textures set `colorSpace = SRGBColorSpace`; data textures (bump, specular) don't. Light intensities are multiplied by `Math.PI` to match the old r128 look.
7. **Audio must start from a user gesture.** `AudioEngine.init()` and `Voice.prepare()` are called inside `start()`/toggle handlers. Don't create the AudioContext on page load.
8. **Run `npm run build` before declaring a task done.**

## Core mechanics (current tuning)

All in `game/constants.ts` and `Game.ts`.

- **Distance:** game units → km via `kmAt()`. First 1,200 units are the atmosphere (0–100 km, ~20 s). Remaining 12,000 units map to 100–384,400 km with exponent 1.9, so the back half is where km pile up. Total 13,200 units ≈ 2 minutes.
- **Speed:** `40 + min(100, t * 1.2)` units/s. Near-miss boost adds up to +35% (`MAX_BOOST`), decaying over ~1 s. Boosted distance doesn't cost extra fuel.
- **Fuel:** starts at 100, burns `1.8 * speed/60` per second. Canisters give +30, spawn every 150–200 units, have a glowing ring and a magnet pull within 6 units. Low-fuel warning and alarm below 25%.
- **Obstacles by altitude:** balloons below 100 km; satellites (55%) and junk up to 60,000 km; asteroids beyond. 42% are aimed near the ship's current position. Spawn gap shrinks from 26 to 8.5 units with progress (34 in atmosphere). Spawned 470 units ahead.
- **Collision:** sphere check, `distance < radius + 0.55`.
- **Lanes:** ship clamped to x ±13, y ±7.5.

### Near-miss system

When an obstacle passes the ship (`q.z > ship.z`, checked once via `passed`), edge gap = 2D distance − radius:

- `0.5 ≤ gap < 2.2` → **Close call** (+5 fuel). `gap < 1.1` → **Razor thin** (+9 fuel).
- Streak: near misses within 4 s chain; each step adds +2 fuel (capped at +10 extra). Chime pitch rises with streak.
- Effects: pop-up text on the passing side, edge flash, camera kick, speed surge, FOV widening.
- Slow motion (time scale 0.3 → 1 over ~0.95 s, with audio lowpass "whomp") on razor-thin or streak ≥ 3, with 1.6 s cooldown.
- End screen shows close calls and best streak; included in share links.

### Deflector

Shooting is earned by flying dangerously, so it feeds the near-miss system instead of replacing it. Numbers in `constants.ts`; logic in `game/deflector.ts`; consequences in `Game.deflected()`.

- **Armed in space only:** 3.5 s after the Kármán line (after the quiet moment) with one free shot, a charging sound and the "armed" line (retried until the radio is free; it's the only tutorial). Firing below 100 km gets the "not authorized … weather balloons" line once.
- **Charge:** 3 slots. Close call +1/3, razor +2/3, +1/6 per streak step; one pass never earns more than a slot (the server relies on this). 1.5 s cooldown between shots (pips glow red).
- **Aim assist:** locks the nearest asteroid/junk/satellite 16–320 units ahead in a narrow cone (sticky). Reticle is amber, red with a "Satellite" label on satellites. Never locks fuel or balloons; bolts pass through fuel. Unlocked shots go straight ahead; a shot that hits nothing is a miss.
- **Controls:** click or Space on desktop; on touch, the fire button above the PiP (`.fire`, coarse pointers only) or a second finger while the first steers.
- **Outcomes:** small asteroids shatter; asteroids with radius ≥ `SPLIT_RADIUS` split into 2–3 faster fragments (+ a short slow-mo beat); junk vaporizes (+3 fuel, "Orbital cleanup"); satellites become a spreading debris cloud and Houston gets cross (priority 2.5, so it beats milestone chatter). Crashing into your own fragments/debris has its own ending lines (`splitCrash`, `kesslerCrash`). A destroyed obstacle gives no near-miss reward.
- **Fairness:** fragments and debris use `debrisRng` (seeded from the run seed but separate from `rng`), so shooting never changes the daily layout for anyone else. Leaderboard is still distance only.
- **Stats:** `RunResult.shots / asteroids / satellites / junk`. End screen shows them; share links carry `ad` (asteroids) and `sd` (satellites, the shame stat, red on the share card).
- Test flights that start past 100 km begin armed and fully charged.

### Milestones

Defined in `MILESTONES` (km, title, detail, chatter key): 11, 50, 100 (Kármán line), 408 (ISS), 2,000, 20,200 (GPS), 35,786 (GEO), 100,000, 192,200 (halfway), 300,000, 370,000. Each shows a lower-third toast and triggers chatter. Kármán line also triggers the audio "silence" moment.

## Visual design

- **Look:** cinematic realism. Procedural Earth (continents, ice, clouds, atmosphere glow) falls away below; sky shader fades from blue to black by 100 km; stars fade in; sun with bloom and DOM lens-flare ghosts; Moon grows ahead with a custom lit shader (independent light direction so it always reads as lit).
- **Camera:** chase cam with smoothing, speed shake, FOV `58 + speed*0.07 + boost*9`; orbit cam on title and after crashes.
- **Quality:** touch devices with ≤4 cores get pixel ratio 1.25, no antialias, no bloom.
- **UI type:** Barlow Condensed (200/300/500) for display numbers and titles; Barlow for body.
- **UI colors:** `--space #02040b`, `--ink #eef2ff`, `--haze #9aabcf`, `--flare #ffb347` (amber accent: fuel, markers, speaker names), `--signal #ff4d5e` (low fuel).
- **HUD:** top-centre Earth→Moon track + big km + percentage; bottom-left mission time; bottom-right fuel; milestone lower-thirds bottom-left; chatter subtitles under the km counter; near-miss pop at 60% height; mute and voice buttons top-right.
- Keep the HUD thin and cinematic. No heavy panels, no all-caps labels.

## Audio

All synthesized in `AudioEngine` (no files):

- Engine: brown noise lowpass + sawtooth sub + rasp band; muffled heavily in space ("felt through the hull").
- Wind in atmosphere, scaled by speed; fades out by 100 km.
- Space pad: detuned sine/triangle chord that swells with the space factor.
- Kármán moment: master ducks to near-silence, then recovers as the pad swells.
- SFX: countdown beeps, liftoff roar, panned whooshes, pickup chime, alarm, radio blip, near-miss chime (pitch by streak), slow-mo whomp, explosion, sputter, Moon chord, Quindar tones (2525 Hz in / 2475 Hz out, as on Apollo).
- Ducking: engine and wind drop to 50% while a voice line plays.
- Mute (M key / button) persists in `localStorage` (`moonrace-muted`).
- `ignition()` plays when the engines light on the pad; `liftoff()` at T-0.

## Mission control chatter

- Lines live in `game/lines.ts` as `Record<key, (string | [speaker, text])[]>`. Default speaker is "Houston"; guests include "ISS" and "GPS satellite".
- **Priority:** 0 minor (pickup), 1 reactions (near misses, low fuel, tip), 2 story beats (launch, milestones, asteroid field), 3 endings (always interrupts). Lower priority can't interrupt equal or higher. Cooldown of 3.5 s after a line for priority < 2.
- **Chance gates:** close call 35%, razor 60%, streak3 70%, streak5 80%, pickup 12%.
- No back-to-back repeats per key.
- The tip line plays only in a player's first 3 runs (`moonrace-runs`).
- The ending line becomes the **quote on the end screen and share image**. This is an important viral hook; keep ending lines short and funny.
- Voice: `Voice.speak()` plays `/voice/<id>.mp3` through highpass 320 Hz → lowpass 3.4 kHz → tanh saturation if listed in `public/voice/manifest.json`; otherwise browser `speechSynthesis` (placeholder quality, no radio filter). Subtitle typing speed matches voice duration. Voice toggle: V key / button, persists as `moonrace-voice`.

## Backend

- **Run tokens** (`lib/token.ts`): HMAC-SHA256 over `{ runId, seed, day, iat }`. Issued before a run; the client prefetches one so Launch starts instantly.
- **Validation** (`lib/validate.ts`) rejects: invalid reason or numbers; token older than 2 h; `durationMs > elapsed since issue + 2 s`; `km > kmAt(maxUnitsIn(duration)) * 1.01 + 1`; Moon claim without full distance; implausible close-call counts.
- Deflector stats (optional fields, older clients omit them): `shots ≤ maxShots(closeCalls)` (= close calls + 1) and `asteroids + satellites ≤ shots`.
- **Replay protection:** `claimRun(runId)` (Redis `SET NX`). **Rate limit:** 20 finishes/min/IP.
- **Storage keys (Redis):** `board:<day>` sorted set (score = km), `run:<runId>` JSON, `runs:<day>` counter, `moon:first`, `used:<runId>`, `rl:*`. Day data expires after 8 days.
- **Names:** `cleanName()` keeps letters, digits, space, `_ . -`, max 18 chars, default "Anonymous pilot".
- Offline or failed ticket → the run still plays with the local daily seed, but isn't submitted.

**Known limitation:** this stops casual cheating only. Before any real prize, add input recording and server-side replay verification for top scores.

## Sharing

- Share URL: `/share?p=<pct>&km=<km>&cc=<closeCalls>&ad=<asteroids>&sd=<satellites>&q=<quote>&w=<speaker>` (`ad`/`sd` only when non-zero; `deflectorSummary()` formats them).
- `/share` sets OG/Twitter metadata pointing at `/api/og?...`; its page shows the result and a "Try to beat it" button.
- `navigator.share` on mobile; clipboard fallback on desktop.
- Local best stored as `moonrace-best`; callsign as `moonrace-callsign`.

## Status and known gaps

- The Next.js port builds and the API flow is tested (valid run accepted; replay, forged token, and impossible scores rejected; OG image renders). **The 3D scene in this port has not been visually verified in a browser.** The Three.js upgrade changed color/lighting handling; if visuals differ from the prototype, tune shader `pow()` conversions, light intensities, and bloom threshold first.
- Earth/Moon textures are generated at load (~1 s). Baking them to images is an easy startup win.
- Daily layouts are similar but not identical, because some obstacles aim at the ship's position. For strict fairness, aim at a seeded path in `ObjectFactory.place`.
- Fonts load from Google Fonts via `<link>` (so builds work offline); can switch to `next/font`.
- No analytics, no tests yet.

## Roadmap (agreed priorities)

1. **Record real voice lines** (AI voice or human) and fill `public/voice/manifest.json`.
2. **Ghost of your best run** flying alongside (record ship positions per distance; replay as a translucent rocket). Strong "one more try" driver.
3. **Instant retry:** skip or shorten the countdown on relaunch.
4. **"So close" framing** on the end screen ("3,200 km short of geostationary orbit", "your best passed this point 8 s later").
5. **Unlockable cosmetics** tied to milestones (rocket paint, exhaust trails).
6. **"Beat my run" links** that load a friend's ghost.
7. **Live global layer:** furthest-today counter on the title screen, the "nobody has reached the Moon yet" story, permanent first-to-Moon name.
8. Haptics on mobile for near misses and pickups.
9. Analytics (runs, retries per session, share rate) to measure what actually drives virality.
10. Standalone portal build (Vite + `game/`) for Poki / CrazyGames.

## Working conventions

- Prefer small, focused changes. Keep `Game.ts` readable; extract new systems into their own module under `game/` (e.g. `game/ghost.ts`) with a narrow interface.
- New gameplay numbers belong in `constants.ts` with a comment.
- New UI elements the loop updates go into `HudRefs` and are created in `GameClient`.
- New chatter: add the key to `lines.ts`, trigger with `this.chatter.say(key, priority, chance?)`, rerun `npm run voice:script`.
- Respect `prefers-reduced-motion` for new animations.
- Test on a phone-sized viewport; touch steering is relative drag.
