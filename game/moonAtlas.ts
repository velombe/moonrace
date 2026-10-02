import * as THREE from "three";

/** Places worth pointing a telescope at. Data only; positions are selenographic (degrees, east positive). */
export interface Landmark {
  id: string;
  name: string;
  kind: "Apollo landing site" | "Crater" | "Lunar sea" | "Far side" | "South pole" | "Moonrace landing zone";
  lat: number;
  lon: number;
  detail: string;
  quip: string;
}

export const LANDMARKS: Landmark[] = [
  {
    id: "moonrace", name: "Moonrace landing zone", kind: "Moonrace landing zone", lat: 13, lon: 80,
    detail: "Mare Marginis, the Sea of the Edge, right on the Moon's eastern rim. From here Earth hangs low over the horizon. Every pilot who makes it lands here and can plant a flag.",
    quip: "Parking is free. Getting here is not.",
  },
  {
    id: "apollo11", name: "Tranquility Base", kind: "Apollo landing site", lat: 0.67, lon: 23.47,
    detail: "Apollo 11, July 1969. Neil Armstrong and Buzz Aldrin spent about 21 hours on the surface.",
    quip: "The flag was blown over by the engine on takeoff. Aldrin watched it fall.",
  },
  {
    id: "apollo12", name: "Ocean of Storms", kind: "Apollo landing site", lat: -3.01, lon: -23.42,
    detail: "Apollo 12 landed a short walk from the Surveyor 3 probe and brought pieces of it home.",
    quip: "The first interplanetary parts pickup.",
  },
  {
    id: "apollo15", name: "Hadley Rille", kind: "Apollo landing site", lat: 26.13, lon: 3.63,
    detail: "Apollo 15, 1971. The first mission to bring the Lunar Roving Vehicle.",
    quip: "The car is still parked there. Keys not included.",
  },
  {
    id: "apollo17", name: "Taurus–Littrow", kind: "Apollo landing site", lat: 20.19, lon: 30.77,
    detail: "Apollo 17, December 1972. The last crewed landing. Geologist Harrison Schmitt found orange soil.",
    quip: "Nobody has been back since. Your move.",
  },
  {
    id: "tycho", name: "Tycho", kind: "Crater", lat: -43.31, lon: -11.36,
    detail: "85 km across and only about 108 million years old. Its bright rays reach more than 1,500 km.",
    quip: "The Moon's most dramatic crater. It knows it.",
  },
  {
    id: "copernicus", name: "Copernicus", kind: "Crater", lat: 9.62, lon: -20.08,
    detail: "93 km wide, with terraced walls and central peaks. About 800 million years old.",
    quip: "Often called the monarch of the Moon. Nobody asked the other craters.",
  },
  {
    id: "aristarchus", name: "Aristarchus", kind: "Crater", lat: 23.7, lon: -47.4,
    detail: "40 km wide and the brightest large feature on the Moon.",
    quip: "So bright it shows up even on the unlit part of the Moon, in earthshine.",
  },
  {
    id: "plato", name: "Plato", kind: "Crater", lat: 51.6, lon: -9.4,
    detail: "About 100 km across, with an unusually dark, flat floor of old lava.",
    quip: "The Moon's parking lot.",
  },
  {
    id: "imbrium", name: "Sea of Showers", kind: "Lunar sea", lat: 32.8, lon: -15.6,
    detail: "Mare Imbrium. A basin over 1,100 km across from an ancient giant impact, later flooded with lava.",
    quip: "The seas are dry. Early astronomers were optimists.",
  },
  {
    id: "serenitatis", name: "Sea of Serenity", kind: "Lunar sea", lat: 28, lon: 17.5,
    detail: "Mare Serenitatis. A dark lava plain about 670 km across, one eye of the Man in the Moon.",
    quip: "Serene. Unlike your flying.",
  },
  {
    id: "crisium", name: "Sea of Crises", kind: "Lunar sea", lat: 17, lon: 59.1,
    detail: "Mare Crisium, about 550 km across near the eastern edge. The Soviet Luna 24 probe returned soil from here in 1976.",
    quip: "Named before anyone tried to park there.",
  },
  {
    id: "orientale", name: "Eastern Sea", kind: "Lunar sea", lat: -19.4, lon: -92.8,
    detail: "Mare Orientale. A bullseye of rings about 930 km across, mostly hidden from Earth on the western edge.",
    quip: "Named the Eastern Sea, sits in the west. The map flipped after it was named.",
  },
  {
    id: "shackleton", name: "Shackleton", kind: "South pole", lat: -89.67, lon: 129.78,
    detail: "21 km crater at the south pole. Its floor never sees sunlight and is thought to hold water ice.",
    quip: "Prime real estate for a future Moon base. Bring a lamp.",
  },
  {
    id: "vonkarman", name: "Von Kármán", kind: "Far side", lat: -45.44, lon: 177.6,
    detail: "China's Chang'e 4 made the first soft landing on the far side here, in January 2019.",
    quip: "There is no dark side of the Moon. Just a far side. Same sunlight, worse reception.",
  },
  {
    id: "moscoviense", name: "Sea of Moscow", kind: "Far side", lat: 27.3, lon: 147.9,
    detail: "Mare Moscoviense. One of the few seas on the far side, first seen in Luna 3's photos in 1959.",
    quip: "The far side is almost all highlands. This one didn't get the memo.",
  },
];

/** Unit vector for a lat/lon in the Moon mesh's local space (matches moonSurface's texture layout). */
export function moonPoint(lat: number, lon: number, out = new THREE.Vector3()) {
  const a = THREE.MathUtils.degToRad(lat), b = THREE.MathUtils.degToRad(lon);
  return out.set(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b));
}
