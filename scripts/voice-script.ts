// Exports every mission control line as a recording checklist.
// Usage: npm run voice:script  →  docs/voice-script.csv
import { writeFileSync } from "node:fs";
import { LINES } from "../game/lines.ts";

const rows = [["file", "speaker", "situation", "line"]];
for (const [key, pool] of Object.entries(LINES)) {
  pool.forEach((raw, i) => {
    const [speaker, text] = Array.isArray(raw) ? raw : ["Houston", raw];
    rows.push([`${key}_${i + 1}.mp3`, speaker, key, text]);
  });
}
const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
writeFileSync("docs/voice-script.csv", csv + "\n");
console.log(`Wrote ${rows.length - 1} lines to docs/voice-script.csv`);
