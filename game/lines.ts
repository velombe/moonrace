/**
 * All mission control lines. Each line's voice file is /voice/<key>_<n>.mp3
 * (n starts at 1), e.g. "launch_2.mp3". Run `npm run voice:script` to export
 * the full recording checklist to docs/voice-script.csv.
 */
export type Line = string | [speaker: string, text: string];

export const LINES: Record<string, Line[]> = {
  launch: ["Liftoff. Try not to hit anything expensive.", "You are go for the Moon. Probably.", "Engines look good. Pilot looks nervous. Proceed.", "Godspeed. Also, please return the rocket."],
  tip: ["Tip from Houston: flying close to things refills fuel. Flying into things does not.", "Reminder: canisters are fuel. Satellites are not."],
  cruise: ["Passing airliner altitude. Somebody in 14C just dropped their pretzels.", "Commercial flights report a rocket. We told them it's a bird."],
  strato: ["Sky's getting dark. That's normal. Probably.", "Stratosphere. The air up here is mostly opinions."],
  karman: ["Welcome to space, pilot. Enjoy the quiet.", "You're officially an astronaut. The paperwork is terrible."],
  iss: [["ISS", "Was that a rocket? Somebody wave."], ["ISS", "We saw that. The whole station saw that."], "The ISS says you owe them a new window."],
  leo: ["Leaving low Earth orbit. Traffic gets worse from here.", "Earth is getting smaller. That's how you know it's working."],
  gps: ["GPS satellites ahead. Try not to break everyone's maps.", ["GPS satellite", "Recalculating route."]],
  geo: ["Geostationary orbit. These satellites haven't moved in years. Don't be the reason they start.", "Weather satellites report a 100% chance of you."],
  deep: ["Deep space. The signal's getting weaker. So is my confidence.", "From here on it's you, the dark, and whatever that was."],
  half: ["Halfway there. Don't get cocky.", "Halfway. Someone down here just ordered you a pizza. Theoretically."],
  approach: ["The Moon is right there. It's bigger than it looks on TV.", "Lunar approach. Everyone here stopped pretending to work."],
  final: ["Final stretch. The whole room is standing.", "Don't look at the Moon. Look at the rocks. Then the Moon."],
  asteroids: ["Asteroid field ahead. Nobody told us about this.", "Rocks incoming. Big ones. Good luck."],
  close: ["That was close.", "Did you just high-five a satellite?", "My coffee went cold watching that.", "Houston, we have a daredevil.", "Please stop doing that. Actually, fuel's up. Keep doing that."],
  razor: ["I felt that one in my teeth.", "You shaved the paint off that thing.", "Flight surgeon says my heart rate is not okay.", "That was so close it owes you dinner."],
  streak3: ["Three in a row. Are you okay?", "Somebody get this pilot a highlight reel."],
  streak5: ["Pilot, this is not a stunt show. Please continue the stunt show.", "Five straight. We've stopped breathing down here."],
  pickup: ["Fuel secured. Accounting thanks you.", "Nice grab. That one was full."],
  lowfuel: ["Fuel's looking thin, pilot.", "You're running on vibes and fumes up there.", "Grab a canister. Or fly scary close to things. Your call."],
  crash: ["Houston, we have a problem.", "Well. That's going in the report.", "We're calling that a rapid unscheduled disassembly.", "Okay. Nobody tell the taxpayers.", "That was a very expensive firework."],
  balloonCrash: ["You hit a weather balloon. Today's forecast: embarrassing.", "The weather balloon won. Let that sink in."],
  nofuel: ["Out of fuel. You're a very expensive satellite now.", "Engines quiet. Enjoy the view while we figure this out."],
  moon: ["You made it. Everyone in this room is crying.", "The Moon. You actually did it. Somebody update the website."],
  touchdown: ["Contact. You're on the Moon. Somebody tell the website.", "Touchdown confirmed. The whole room just stood up.", "The rocket has landed. Upright, even. We're impressed."],
  planted: ["Flag's up. History books, take note.", "Nice flag. It's not waving, by the way. No air. That's normal."],
  plaque: ["Lovely panel. Very official. Very you.", "Panel installed. Future tourists will read that."],
};

