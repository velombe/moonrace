# moonrace.lol

A cinematic 3D race from Earth to the Moon. Next.js (App Router) + Three.js, with procedural
visuals and audio, mission control chatter, near misses, a shared daily run, leaderboards, and
share images.

## Run it

```bash
npm install
cp .env.example .env.local   # set RUN_SECRET to any long random string
npm run dev                  # http://localhost:3000
```

`npm run build && npm start` runs the production build. Production requires `RUN_SECRET`.

Without Upstash credentials the app uses an in-memory store, which is fine locally but resets on
restart and isn't shared between serverless instances. For real deployments, create a free Upstash
Redis database and set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

## Deploy (Vercel)

1. Push this folder to a GitHub repo and import it in Vercel.
2. Add the environment variables from `.env.example` (use your real domain for `NEXT_PUBLIC_SITE_URL`,
   e.g. `https://moonrace.lol`).
3. Point the moonrace.lol domain at the project.

## Project layout

```
app/
  page.tsx                 the game (client-only, loaded via components/GameLoader)
  leaderboard/page.tsx     today's board, rendered on the server
  share/page.tsx           share landing page with a rich preview image
  api/run/start            issues a signed run token + today's seed
  api/run/finish           validates a result and records it
  api/stats                today's top runs, run count, first to the Moon
  api/og                   1200x630 share image for any result
components/
  GameClient.tsx           React shell: HUD markup, menus, end screen, sharing
game/                      framework-free game engine (no React inside)
  Game.ts                  loop, state, input, collisions, near misses
  constants.ts             distances, speeds, milestones (shared with the server)
  lines.ts                 every mission control line
  chatter.ts               subtitles + Quindar tones + voice playback
  audio/AudioEngine.ts     synthesized engine, wind, space ambience, effects
  audio/Voice.ts           recorded clips with radio filter, browser speech fallback
  world/                   sky, Earth, Moon, rocket, obstacles, procedural textures
lib/                       daily seed, run tokens, storage, validation, share links
public/voice/              recorded voice lines + manifest.json
```

The game engine never touches React state during play. The HUD is written directly to DOM
elements passed in by `GameClient`, and React only handles menus and the end screen. Keep it that
way and it stays fast.

## The daily run

Everyone gets the same seed each UTC day (`lib/daily.ts`), so obstacles and fuel follow the same
sequence for all players. Some obstacles are aimed near the player's current position, so layouts
match closely rather than exactly. For a strictly identical course, aim them at a seeded path
instead of the ship in `ObjectFactory.place`.

## Anti-cheat

Scores are submitted with a signed run token issued before the run starts. The server rejects
forged or reused tokens, runs longer than the time since the token was issued, distances a perfect
always-boosting player couldn't reach in the claimed time, Moon claims without the distance, and
more than 20 submissions a minute per IP. This stops casual cheating. Before offering real prizes,
record player inputs and replay them on the server for top scores.

## Recording the voice lines

1. Run `npm run voice:script` to export `docs/voice-script.csv` (file name, speaker, situation, line).
   A copy is already included.
2. Record or generate each line as an MP3 with that exact file name, and put it in `public/voice/`.
   Dry, close-mic'd, no reverb works best: the game adds the radio filter itself.
3. List the recorded files (without `.mp3`) in `public/voice/manifest.json`:
   `{ "lines": ["launch_1", "launch_2", "karman_1"] }`

Recorded lines play through the radio filter; anything not in the manifest falls back to browser
speech, so you can record gradually. If you use an AI voice service, check that your plan allows
commercial use.

To add or change lines, edit `game/lines.ts`. Keep the order stable once recorded, since file names
come from each line's position.

## Performance notes

- Earth and Moon textures are generated on load (about a second). To speed up startup, bake them to
  images in `public/` and load them with `THREE.TextureLoader`.
- On touch devices with 4 or fewer CPU cores, the game lowers resolution and disables bloom.
- In development, React Strict Mode mounts the game twice, so the first load is slower than in
  production.
- Fonts load from Google Fonts at runtime. You can switch to `next/font/google` for self-hosting.

## Web game portals

Portals like Poki and CrazyGames want a standalone build. Because `game/` is framework-free, you can
bundle `Game.ts` with a small HTML shell (Vite works well) and point the API calls at your domain or
disable them.
