// Shared by the client game and the server-side score validation.

export const MOON_KM = 384_400;
/** Game distance (units) spent in the atmosphere phase, up to the Kármán line. */
export const ATMOSPHERE_UNITS = 1200;
/** Total game distance (units) from launch to the Moon. */
export const TOTAL_UNITS = 13_200;

export const BASE_SPEED = 40;
export const MAX_EXTRA_SPEED = 100;
export const SPEED_RAMP = 1.2; // units/s gained per second
export const MAX_BOOST = 0.35; // near-miss surge multiplier

export const FUEL_BURN = 1.8; // per second at speed 60
export const FUEL_PICKUP = 30;

// Deflector: shots are earned by flying close to things, never handed out.
export const DEFLECTOR_ARM_KM = 100; // armed in space only (Kármán line)
export const DEFLECTOR_SLOTS = 3; // stored shots
export const CHARGE_CLOSE = 1 / 3; // slot fraction per close call
export const CHARGE_RAZOR = 2 / 3; // per razor-thin pass
export const CHARGE_STREAK = 1 / 6; // extra per streak step, capped so one pass never earns more than a slot
export const DEFLECTOR_COOLDOWN = 1.5; // seconds between shots, even with charge left
export const JUNK_CLEANUP_FUEL = 3; // "orbital cleanup" bonus
export const SPLIT_RADIUS = 2.1; // asteroids at least this big split instead of shattering

/**
 * Most shots a run can fire: one free shot on arming plus at most one per near
 * miss (CHARGE_RAZOR + capped streak bonus ≤ 1 slot). Shared with the server.
 */
export function maxShots(closeCalls: number): number {
  return closeCalls + 1;
}

/** Maps game distance (units) to real-world kilometres from Earth. */
export function kmAt(units: number): number {
  if (units < ATMOSPHERE_UNITS) return 100 * Math.pow(units / ATMOSPHERE_UNITS, 1.5);
  const q = Math.min(1, (units - ATMOSPHERE_UNITS) / (TOTAL_UNITS - ATMOSPHERE_UNITS));
  return 100 + (MOON_KM - 100) * Math.pow(q, 1.9);
}

/** Inverse of kmAt(): game distance (units) at which `km` is reached. */
export function unitsAt(km: number): number {
  if (km <= 100) return ATMOSPHERE_UNITS * Math.pow(Math.max(0, km) / 100, 1 / 1.5);
  const q = Math.pow(Math.min(1, (km - 100) / (MOON_KM - 100)), 1 / 1.9);
  return ATMOSPHERE_UNITS + q * (TOTAL_UNITS - ATMOSPHERE_UNITS);
}

export function speedAt(seconds: number): number {
  return BASE_SPEED + Math.min(MAX_EXTRA_SPEED, seconds * SPEED_RAMP);
}

/**
 * Upper bound of distance a perfect player could cover in `seconds`
 * (always boosting). Used by the server to reject impossible scores.
 */
export function maxUnitsIn(seconds: number): number {
  const rampEnd = MAX_EXTRA_SPEED / SPEED_RAMP;
  const s = Math.max(0, seconds);
  let units: number;
  if (s <= rampEnd) units = BASE_SPEED * s + 0.5 * SPEED_RAMP * s * s;
  else {
    units =
      BASE_SPEED * rampEnd +
      0.5 * SPEED_RAMP * rampEnd * rampEnd +
      (BASE_SPEED + MAX_EXTRA_SPEED) * (s - rampEnd);
  }
  return units * (1 + MAX_BOOST);
}

export interface Milestone {
  km: number;
  title: string;
  detail: string;
  chatter: string;
}

export const MILESTONES: Milestone[] = [
  { km: 11, title: "Cruising altitude", detail: "Leaving the airliners behind", chatter: "cruise" },
  { km: 50, title: "Stratosphere", detail: "The sky is turning dark", chatter: "strato" },
  { km: 100, title: "Kármán line", detail: "100 km up. Welcome to space", chatter: "karman" },
  { km: 408, title: "International Space Station", detail: "Wave as you pass", chatter: "iss" },
  { km: 2000, title: "Leaving low Earth orbit", detail: "Earth is falling away", chatter: "leo" },
  { km: 20200, title: "GPS constellation", detail: "20,200 km up", chatter: "gps" },
  { km: 35786, title: "Geostationary orbit", detail: "35,786 km up", chatter: "geo" },
  { km: 100000, title: "Deep space", detail: "100,000 km from home", chatter: "deep" },
  { km: 192200, title: "Halfway", detail: "192,200 km to go", chatter: "half" },
  { km: 300000, title: "Lunar approach", detail: "The Moon fills the sky", chatter: "approach" },
  { km: 370000, title: "Final stretch", detail: "Hold steady", chatter: "final" },
];

export type EndReason = "balloon" | "satellite" | "junk" | "asteroid" | "fuel" | "moon";

export const END_REASON_TEXT: Record<EndReason, string> = {
  balloon: "Hit a weather balloon",
  satellite: "Collided with a satellite",
  junk: "Struck by space debris",
  asteroid: "Smashed into an asteroid",
  fuel: "Ran out of fuel",
  moon: "Reached the Moon",
};

export function formatPct(v: number): string {
  if (v >= 100) return "100%";
  if (v < 1) return v.toFixed(2) + "%";
  if (v < 10) return v.toFixed(1) + "%";
  return Math.floor(v) + "%";
}

export function formatKm(km: number): string {
  return Math.floor(km).toLocaleString("en-US");
}
