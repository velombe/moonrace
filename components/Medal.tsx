import { MOON_KM } from "@/game/constants";

export type MedalTier = "cadet" | "bronze" | "silver" | "gold" | "moon";

/** The medal a run earns, by how far it got (milestones from constants.ts). */
export function medalFor(km: number, reachedMoon: boolean): { tier: MedalTier; title: string } {
  if (reachedMoon || km >= MOON_KM) return { tier: "moon", title: "Moonwalker" };
  if (km >= 192_200) return { tier: "gold", title: "Halfway hero" };
  if (km >= 35_786) return { tier: "silver", title: "Geostationary" };
  if (km >= 100) return { tier: "bronze", title: "Astronaut" };
  return { tier: "cadet", title: "Cadet" };
}

const COLORS: Record<MedalTier, [string, string, string, string]> = {
  // highlight, mid, shadow, ring
  cadet: ["#e9eefb", "#9aa6c4", "#4b5674", "#d8e0f5"],
  bronze: ["#ffd9bd", "#d08a57", "#7a4322", "#f3b98d"],
  silver: ["#ffffff", "#c9d0dc", "#6f7888", "#eef2ff"],
  gold: ["#fff1c4", "#f2c35a", "#9c6a1c", "#ffe39a"],
  moon: ["#ffffff", "#d9dcf0", "#6d78a8", "#bfe8ff"],
};

/** Mission-patch medal: a star, or a crescent for reaching the Moon. */
export default function Medal({ tier, size = 84 }: { tier: MedalTier; size?: number }) {
  const [hi, mid, lo, ring] = COLORS[tier], id = `medal-${tier}`;
  return (
    <svg className={`medal ${tier}`} width={size} height={size * 1.25} viewBox="0 0 64 80" aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor={hi} />
          <stop offset=".55" stopColor={mid} />
          <stop offset="1" stopColor={lo} />
        </radialGradient>
      </defs>
      <path d="M20 50 L12 78 L22 72 L28 79 L32 54 Z" fill="#ff7420" />
      <path d="M44 50 L52 78 L42 72 L36 79 L32 54 Z" fill="#c9500f" />
      <circle cx="32" cy="30" r="27" fill={`url(#${id})`} />
      <circle cx="32" cy="30" r="21.5" fill="none" stroke={ring} strokeOpacity=".75" strokeWidth="1.2" strokeDasharray="1.2 2.6" />
      <circle cx="32" cy="30" r="27" fill="none" stroke="#000" strokeOpacity=".25" strokeWidth="1.2" />
      {tier === "moon" ? (
        <path d="M38 17a14 14 0 1 0 0 26 11 11 0 1 1 0-26Z" fill="#2b3566" fillOpacity=".8" />
      ) : (
        <path d="M32 15l4.4 9 9.9 1.4-7.2 7 1.7 9.8L32 37.6 23.2 42.2l1.7-9.8-7.2-7 9.9-1.4Z" fill="#1a1407" fillOpacity={tier === "cadet" ? 0.45 : 0.72} />
      )}
    </svg>
  );
}
