// Sky and earth, living things, science and maths: the everyday things a school subject is explained with.
import type { DrawingSet } from "../types";

/** The friendly face every creature shares: two dot eyes and a smile, centred on x = 32. */
const face = (y: number, gap = 5.5, r = 1.7) =>
  `<circle class="d-ink" cx="${32 - gap}" cy="${y}" r="${r}"/><circle class="d-ink" cx="${32 + gap}" cy="${y}" r="${r}"/>` +
  `<path class="d-line thin" d="M${32 - gap + 1.5} ${y + 4.5}q${gap - 1.5} 3.5 ${2 * gap - 3} 0"/>`;
const STAR = "l6.8 16.7 17.9 1.3-13.8 11.6 4.4 17.4-15.3-9.5-15.3 9.5 4.4-17.4-13.8-11.6 17.9-1.300z".replace(/00\b/g, "");

export const NATURE: DrawingSet = {
  sun: { also: ["daylight", "sunshine", "a source of energy", "warmth", "solar power", "daytime"], tint: "#f6c945", svg:
    '<path class="d-line thick tint" d="M32 6v7M32 51v7M6 32h7M51 32h7M18.6 18.600l-5-5M45.4 18.600l5-5M18.6 45.400l-5 5M45.4 45.400l5 5"/>' +
    '<circle class="d-t" cx="32" cy="32" r="15.5"/><circle class="d-t3" cx="26" cy="24.5" r="3"/>' + face(30.5) +
    '<circle class="d-pk" cx="22.5" cy="35" r="2.3" opacity=".6"/><circle class="d-pk" cx="41.5" cy="35" r="2.3" opacity=".6"/>' },
  moon: { also: ["night", "a satellite", "the night sky", "a month", "an orbiting body", "bedtime"], tint: "#f1e3a0", svg:
    '<path class="d-t" d="M42 11.200A24 24 0 1 0 42 52.8 22.3 22.3 0 0 1 42 11.200z"/>' +
    '<circle class="d-t2" cx="15" cy="30" r="2.8"/><circle class="d-t2" cx="21.5" cy="43" r="2.2"/><circle class="d-t2" cx="21" cy="19.5" r="1.7"/>' +
    '<path class="d-w" d="M47 22l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.500zM55 39l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1z"/>' },
  star: { also: ["a reward", "a gold star", "a favourite", "a prize", "a top mark", "a point of light"], tint: "#f3d77a", svg:
    `<path class="d-t2" d="M32 10${STAR}"/><path class="d-t" d="M32 7${STAR}"/><path class="d-line thick tint" d="M32 7${STAR}"/>` +
    '<path class="d-t3" d="M32 11l3.5 9-7 0z"/>' + face(29, 4.5, 1.6) },
  planet: { also: ["saturn", "a world", "the solar system", "an orbit", "space", "a gas giant"], tint: "#e8a36a", svg:
    '<ellipse class="d-line thick yel" cx="32" cy="32" rx="27" ry="8" transform="rotate(-18 32 32)"/>' +
    '<circle class="d-t" cx="32" cy="32" r="17"/><path class="d-t2" d="M47 24a17 17 0 0 1-23 23 21 21 0 0 0 23-23z"/><circle class="d-t3" cx="25" cy="24" r="3.5"/><circle class="d-t2" cx="36" cy="27" r="2"/>' +
    '<path class="d-line thick yel" d="M5 32a27 8 0 0 0 54 0" transform="rotate(-18 32 32)"/>' },
  drop: { also: ["rain", "water", "a liquid", "a raindrop", "a tear", "condensation", "a drip"], tint: "#6fb8ea", svg:
    '<path class="d-t" d="M32 6q-18 21-18 33a18 18 0 0 0 36 0q0-12-18-33z"/><path class="d-t2" d="M50 39a18 18 0 0 1-28 15 20 20 0 0 0 28-15z"/>' +
    '<path class="d-line white" d="M21 30q2-5 5-9" opacity=".7"/>' + face(38, 6) },
  fire: { also: ["a flame", "combustion", "heat", "burning", "a campfire", "energy released"], tint: "#f08a3c", svg:
    '<path class="d-t" d="M30 5c3 10 18 17 18 33a16 16 0 0 1-32 0c0-6 3-10 5-13 1 4 3 6 5 6 2-8-3-16 4-26z"/>' +
    '<path class="d-y" d="M32 26c2 6 9 9 9 16a9 9 0 0 1-18 0c0-4 2-6 4-9 1 3 2 4 3 4 1-4-1-7 2-11z"/><ellipse class="d-cream" cx="32" cy="45" rx="3.5" ry="4.5"/>' +
    '<rect class="d-wood" x="13" y="51" width="38" height="6" rx="3" transform="rotate(10 32 54)"/><rect class="d-wood" x="13" y="51" width="38" height="6" rx="3" transform="rotate(-10 32 54)"/>' },
  mountain: { also: ["a hill", "a peak", "a summit", "a volcano", "a barrier", "high ground", "a climb"], tint: "#7d8fa8", svg:
    '<path class="d-t2" d="M30 54L46 22l14 32z"/><path class="d-w" d="M46 22l3.5 8-2-1.2-2 2.4-1.8-2.4-1.7 1.200z"/>' +
    '<path class="d-t" d="M4 54L26 12l22 42z"/><path class="d-w" d="M26 12l7 13.4-3.5-2.4-3.5 4-3.5-4-3.5 2.400z"/>' +
    '<rect class="d-gr2" x="3" y="52" width="58" height="6" rx="3"/>' },
  river: { also: ["a stream", "a flow", "a current", "a channel", "a tributary", "a waterway"], tint: "#5aa9e6", svg:
    '<rect class="d-gr2" x="5" y="10" width="54" height="46" rx="7"/><circle class="d-gr" cx="15" cy="22" r="5"/><circle class="d-gr" cx="50" cy="25" r="4.5"/><circle class="d-gr" cx="13" cy="42" r="3.5"/>' +
    '<path class="d-t" d="M38 10c-2 8-16 8-14 18 2 8 14 8 10 18-2 5-12 6-16 10h20c10-4 12-8 10-12-2-8-17-9-16-17 1-7 10-9 12-17z"/>' +
    '<path class="d-line thin grey" d="M33 21q2 1 4 0M27 32q2 1 4 0M38 45q3 1.5 6 0M27 53q3 1.5 6 0"/>' },
  wave: { also: ["the sea", "the ocean", "a tide", "a surge", "a ripple", "an oscillation", "a swell"], tint: "#4fa3e0", svg:
    '<path class="d-t" d="M5 56V42c9-2 12-26 30-28 10-1 17 6 16 14-1 5-5 7-9 6 2-4-1-8-5-8-6 0-9 6-8 12 1 7 8 10 15 10h15v8z"/>' +
    '<path class="d-t2" d="M5 50q6.75-4 13.5 0t13.5 0 13.5 0 13.5 0v6h-54z"/>' +
    '<circle class="d-w" cx="50" cy="29" r="3.5"/><circle class="d-w" cx="45.5" cy="33.5" r="3"/><circle class="d-w" cx="56" cy="22" r="1.5"/><circle class="d-w" cx="57" cy="31" r="1.2"/>' },
  tree: { also: ["a plant", "a forest", "an oak", "a family tree", "wood", "a branching structure"], tint: "#5fb36a", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="14" ry="2"/><rect class="d-wood" x="28" y="36" width="8" height="22" rx="2"/>' +
    '<g class="d-t2"><circle cx="20" cy="32" r="10"/><circle cx="44" cy="32" r="10"/><circle cx="32" cy="30" r="12"/></g>' +
    '<g class="d-t"><circle cx="32" cy="20" r="14"/><circle cx="19.5" cy="28" r="10"/><circle cx="44.5" cy="28" r="10"/></g><circle class="d-t3" cx="26" cy="15" r="4"/><circle class="d-t3" cx="39" cy="24" r="2.5"/>' },
  leaf: { also: ["photosynthesis", "a plant part", "foliage", "a plant's solar panel", "autumn", "chlorophyll"], tint: "#6cc070", svg:
    '<path class="d-line thick tint" d="M8 57l8-9"/><path class="d-t" d="M54 8C30 6 10 20 14 46c26 4 42-14 40-38z"/><path class="d-t2" d="M54 8c2 24-14 42-40 38z"/>' +
    '<path class="d-line thin grey" d="M14 46l30-28M23 37.500v-11M23 37.500h11M32 29v-9M32 29h9"/>' },
  flower: { also: ["a blossom", "a bloom", "a daisy", "pollination", "a garden", "spring"], tint: "#f08fb0", svg:
    '<rect class="d-gr2" x="30.5" y="30" width="3" height="28" rx="1.5"/><path class="d-gr" d="M32 52q-11 0-13-9 11 0 13 9zM32 47q11 0 13-9-11 0-13 9z"/>' +
    '<g class="d-t"><circle cx="42" cy="22" r="7.5"/><circle cx="37" cy="30.7" r="7.5"/><circle cx="27" cy="30.7" r="7.5"/><circle cx="22" cy="22" r="7.5"/><circle cx="27" cy="13.3" r="7.5"/><circle cx="37" cy="13.3" r="7.5"/></g>' +
    '<circle class="d-y" cx="32" cy="22" r="6.5"/><circle class="d-y2" cx="32" cy="22" r="2.8"/>' },
  sprout: { also: ["a seedling", "growth", "a seed", "a shoot", "a new start", "germination", "an investment growing"], tint: "#6cc070", svg:
    '<path class="d-t2" d="M30.5 47V25h3v22z"/><path class="d-t" d="M32 30C21 30 13 24 12 13c11 0 20 6 20 17z"/><path class="d-t3" d="M32 25c0-10 8-16 19-16 0 11-8 17-19 16z"/>' +
    '<path class="d-wood" d="M6 57q2-13 26-13t26 13z"/><circle class="d-cream" cx="20" cy="52" r="1.5"/><circle class="d-cream" cx="42" cy="50" r="1.5"/><circle class="d-cream" cx="48" cy="54.5" r="1.2"/>' },
  dog: { also: ["a puppy", "a pet", "a pet dog", "a mammal", "a loyal friend"], tint: "#e0b070", svg:
    '<ellipse class="d-t2" cx="48" cy="45" rx="3" ry="8" transform="rotate(32 48 45)"/><ellipse class="d-t" cx="32" cy="47" rx="12" ry="12"/><ellipse class="d-t3" cx="32" cy="49" rx="6.5" ry="8"/>' +
    '<ellipse class="d-t2" cx="24" cy="56.5" rx="5.5" ry="3.5"/><ellipse class="d-t2" cx="40" cy="56.5" rx="5.5" ry="3.5"/>' +
    '<ellipse class="d-t" cx="32" cy="22" rx="15" ry="13.5"/><rect class="d-rd" x="23" y="34.5" width="18" height="4" rx="2"/><circle class="d-y" cx="32" cy="39.5" r="2.2"/>' +
    '<ellipse class="d-t2" cx="15.5" cy="23" rx="5.5" ry="11" transform="rotate(12 15.5 23)"/><ellipse class="d-t2" cx="48.5" cy="23" rx="5.5" ry="11" transform="rotate(-12 48.5 23)"/>' +
    '<circle class="d-t2" cx="38.5" cy="19.5" r="4.5"/><ellipse class="d-t3" cx="32" cy="27.5" rx="7.5" ry="6"/><rect class="d-pk" x="30.5" y="29" width="3" height="5" rx="1.5"/>' +
    '<circle class="d-ink" cx="26" cy="19.5" r="1.7"/><circle class="d-ink" cx="38.5" cy="19.5" r="1.7"/><ellipse class="d-ink" cx="32" cy="24.5" rx="2.8" ry="2"/><path class="d-line thin" d="M32 26.500v2m-3.5.3q3.5 2.6 7 0"/>' },
  cat: { also: ["a kitten", "a pet cat", "a predator", "a feline", "a hunter", "a curious animal"], tint: "#8b93a6", svg:
    '<path class="d-t2" d="M42 56c11 1 15-7 12-14-1-3-5-2-4 1 1 4-2 7-8 6z"/><ellipse class="d-t" cx="32" cy="47" rx="11.5" ry="12"/><ellipse class="d-t3" cx="32" cy="48" rx="6" ry="8"/>' +
    '<ellipse class="d-t3" cx="26" cy="56.5" rx="4.5" ry="3"/><ellipse class="d-t3" cx="38" cy="56.5" rx="4.5" ry="3"/>' +
    '<path class="d-t" d="M18 23L16 5l14 8zM46 23l2-18-14 8z"/><path class="d-pk" d="M19.5 16l-.5-6 5.5 3.500zM44.5 16l.5-6-5.5 3.500z"/><ellipse class="d-t" cx="32" cy="23" rx="15" ry="13"/>' +
    '<path class="d-t2" d="M31 10.500h2v5h-2zM25.5 12l1.9-.6 1.3 4.3-1.9.6zM38.5 12l-1.9-.6-1.3 4.3 1.9.6z"/>' +
    '<path class="d-line thin grey" d="M21 25.500l-9-1.500M21 28.500l-9 1.500M43 25.500l9-1.500M43 28.500l9 1.5"/>' +
    '<circle class="d-ink" cx="25.5" cy="21.5" r="1.7"/><circle class="d-ink" cx="38.5" cy="21.5" r="1.7"/><path class="d-pk" d="M30.3 25.500h3.400l-1.7 2.200z"/><path class="d-line thin" d="M32 27.700q-2 2.8-4.2 1.300M32 27.700q2 2.8 4.2 1.3"/>' },
  bird: { also: ["a robin", "a sparrow", "a songbird", "a flyer", "a chick", "a migrant"], tint: "#5fb0e8", svg:
    '<path class="d-t2" d="M44 38l15-9-2 15-12 2z"/><path class="d-or" d="M25 48h2v8h3v2h-8v-2h3zM33 48h2v8h3v2h-8v-2h3zM14 27l-9 3.5 9 3.500z"/>' +
    '<path class="d-t" d="M26 17q0-6 5-8 1 4 0 8z"/><ellipse class="d-t" cx="30" cy="33" rx="18" ry="17"/><ellipse class="d-t3" cx="26" cy="40" rx="11" ry="9"/>' +
    '<path class="d-t2" d="M29 30c8-3 17 1 19 10-8 4-17 2-19-10z"/><circle class="d-ink" cx="20.5" cy="27" r="2"/><circle class="d-pk" cx="17.5" cy="33" r="2.4" opacity=".7"/>' },
  fish: { also: ["a goldfish", "a swimmer", "sea life", "prey", "a catch", "an aquatic animal"], tint: "#f0884b", svg:
    '<path class="d-t2" d="M17 32L5 19q-2 13 0 26zM28 20q6-10 17-7l-2 8zM30 44q3 7 10 6l-2-7z"/><ellipse class="d-t" cx="35" cy="32" rx="21" ry="14"/><ellipse class="d-t3" cx="36" cy="38.5" rx="14" ry="6"/>' +
    '<path class="d-t2" d="M29 31q8 0 9 6-9 1-9-6z"/><circle class="d-w" cx="46" cy="28" r="4.2"/><circle class="d-ink" cx="47" cy="28" r="2"/><path class="d-line thin" d="M49.5 36q2.5 1.5 4.5-.5"/>' +
    '<circle class="d-sky" cx="57" cy="14" r="2.2"/><circle class="d-sky" cx="52" cy="8.5" r="1.5"/>' },
  bee: { also: ["a pollinator", "an insect", "a worker", "a honeybee", "a busy worker", "a bug"], tint: "#f6c945", svg:
    '<path class="d-line thin grey" d="M19 28q-3-7-8-7M24 26q-1-6 2-9"/><circle class="d-w2" cx="11" cy="21" r="1.6"/><circle class="d-w2" cx="26" cy="17" r="1.6"/>' +
    '<ellipse class="d-sky" cx="33" cy="19" rx="7" ry="11" transform="rotate(-22 33 19)"/><ellipse class="d-w" cx="43" cy="20" rx="6" ry="10" transform="rotate(20 43 20)"/>' +
    '<path class="d-w2" d="M49 35l7 3-7 3z"/><ellipse class="d-t" cx="32" cy="38" rx="18" ry="13"/>' +
    '<path class="d-ink" d="M30 25.100A18 13 0 0 1 35 25.200V50.800A18 13 0 0 1 30 50.900zM40 26.400A18 13 0 0 1 45 29V47A18 13 0 0 1 40 49.600z"/>' +
    '<circle class="d-ink" cx="19" cy="36" r="1.7"/><circle class="d-ink" cx="25.5" cy="36" r="1.7"/><path class="d-line thin" d="M19.5 40.500q2.8 2.5 5.5 0"/><circle class="d-pk" cx="16.5" cy="40.5" r="1.8" opacity=".7"/>' },
  egg: { also: ["a hen's egg", "an embryo", "a beginning", "an ovum", "a shell", "something fragile"], tint: "#f4ead8", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="15" ry="2.2"/><path class="d-t" d="M32 6c10 0 20 17 20 31a20 20 0 0 1-40 0C12 23 22 6 32 6z"/>' +
    '<path class="d-t2" d="M52 37a20 20 0 0 1-34 14.3 22 22 0 0 0 34-14.300z"/><ellipse class="d-w" cx="24.5" cy="22" rx="3" ry="5.5" transform="rotate(24 24.5 22)" opacity=".8"/>' },
  magnet: { also: ["attraction", "a magnetic field", "a pull", "a force", "an electromagnet", "poles"], tint: "#e0564f", svg:
    '<path class="d-t" d="M10 8h14v26a8 8 0 0 0 16 0V8h14v26a22 22 0 0 1-44 0z"/><path class="d-t2" d="M32 42a8 8 0 0 0 8-8V8h14v26a22 22 0 0 1-22 22z"/>' +
    '<rect class="d-w" x="10" y="8" width="14" height="11"/><rect class="d-w2" x="40" y="8" width="14" height="11"/>' +
    '<path class="d-line yel" d="M28 6l-1.5-3M32 5.500V2M36 6l1.5-3"/>' },
  battery: { also: ["a store of energy", "a power source", "a charge", "a power pack", "stored energy", "a voltage source", "savings"], tint: "#6cc070", svg:
    '<rect class="d-w2" x="26" y="5" width="12" height="9" rx="2"/><rect class="d-t" x="17" y="11" width="30" height="47" rx="5"/><path class="d-t2" d="M40 24h7v29q0 5-5 5h-2z"/>' +
    '<path class="d-dk" d="M22 11h20q5 0 5 5v9H17v-9q0-5 5-5z"/><path class="d-y" d="M34 29l-8 13h5l-2 10 9-14h-5z"/>' },
  bulb: { also: ["a light", "an idea", "a lamp", "a light bulb", "a load in a circuit", "brightness"], tint: "#f6d255", svg:
    '<path class="d-line thick tint" d="M32 4v5M8 28h5M51 28h5M19.3 15.300l-3.5-3.500M44.7 15.300l3.5-3.500M19.3 40.700l-3.5 3.500M44.7 40.700l3.5 3.5"/>' +
    '<path class="d-t" d="M32 14a14 14 0 0 0-8 25.500V46h16v-6.500A14 14 0 0 0 32 14z"/><ellipse class="d-w" cx="26.5" cy="23" rx="2.3" ry="4" transform="rotate(32 26.5 23)" opacity=".8"/>' +
    '<path class="d-line thin" d="M29 45v-8.5a3 3 0 0 1 6 0V45" opacity=".55"/>' +
    '<rect class="d-w2" x="25" y="45" width="14" height="8.5" rx="2"/><rect class="d-dk" x="25" y="48" width="14" height="1.8"/><rect class="d-dk" x="28.5" y="53" width="7" height="4.5" rx="2"/>' },
  atom: { also: ["a particle", "an element", "a nucleus", "electrons", "the smallest piece", "physics"], tint: "#7fbfe6", svg:
    [0, 60, 120].map((a) => `<ellipse class="d-line tint" cx="32" cy="32" rx="25" ry="9.5" transform="rotate(${a} 32 32)"/>`).join("") +
    '<circle class="d-pk" cx="32" cy="32" r="6.5"/><circle class="d-w" cx="30" cy="30" r="1.8" opacity=".7"/>' +
    '<circle class="d-y" cx="57" cy="32" r="3.3"/><circle class="d-y" cx="19.5" cy="10.3" r="3.3"/><circle class="d-y" cx="19.5" cy="53.7" r="3.3"/>' },
  molecule: { also: ["a compound", "a water molecule", "a bond", "atoms joined", "a substance", "particles"], tint: "#e0564f", svg:
    '<path class="d-line thick grey" d="M32 24L14 47M32 24l18 23"/><circle class="d-t2" cx="32" cy="24" r="14.5"/><circle class="d-t" cx="30.5" cy="22.5" r="12"/><circle class="d-t3" cx="26" cy="17.5" r="2.8"/>' +
    '<circle class="d-w2" cx="14" cy="47" r="8.5"/><circle class="d-w" cx="13" cy="46" r="6.8"/><circle class="d-w2" cx="50" cy="47" r="8.5"/><circle class="d-w" cx="49" cy="46" r="6.8"/>' },
  flask: { also: ["a beaker", "a solution", "a chemical", "an experiment", "a reaction", "a test tube", "chemistry"], tint: "#63c2a2", svg:
    '<path class="d-sky" d="M26 8h12v16l16 27q2 5-3 5H13q-5 0-3-5l16-27z"/><rect class="d-w2" x="23" y="5.5" width="18" height="4.5" rx="2.2"/>' +
    '<path class="d-t" d="M17.7 38h28.600l7.7 13q2 5-3 5H13q-5 0-3-5z"/><circle class="d-t3" cx="26" cy="48" r="2.6"/><circle class="d-t3" cx="37" cy="44.5" r="1.8"/><circle class="d-t3" cx="41" cy="51" r="1.5"/>' +
    '<circle class="d-t" cx="31" cy="31" r="2"/><circle class="d-t" cx="34" cy="22" r="1.5"/><path class="d-line white" d="M27.5 13v9" opacity=".7"/>' },
  thermometer: { also: ["temperature", "a fever", "a gauge", "a measurement", "hot and cold", "a reading"], tint: "#e0564f", svg:
    '<rect class="d-w" x="21" y="5" width="14" height="42" rx="7"/><circle class="d-w" cx="28" cy="47" r="12"/><circle class="d-t" cx="28" cy="47" r="8.5"/><rect class="d-t" x="25" y="20" width="6" height="28" rx="3"/>' +
    '<circle class="d-t3" cx="24.5" cy="44" r="2"/><path class="d-line grey" d="M40 11h7M40 18.500h4M40 26h7M40 33.500h4"/>' },
  heart: { also: ["a pump", "the heart", "love", "an engine", "the core", "a heartbeat"], tint: "#e0564f", svg:
    '<rect class="d-bl2" x="22" y="6" width="6.5" height="9" rx="2.5" transform="rotate(-12 25 9)"/><rect class="d-t2" x="35.5" y="6" width="6.5" height="9" rx="2.5" transform="rotate(12 39 9)"/>' +
    '<path class="d-t" d="M32 57C14 45 6 35 6 24c0-8 6-14 13.5-14 5 0 9.5 3 12.5 7 3-4 7.5-7 12.5-7C52 10 58 16 58 24c0 11-8 21-26 33z"/>' +
    '<ellipse class="d-t3" cx="17" cy="21" rx="3" ry="5" transform="rotate(35 17 21)"/>' + face(28, 7) +
    '<circle class="d-pk" cx="20" cy="33" r="2.5" opacity=".8"/><circle class="d-pk" cx="44" cy="33" r="2.5" opacity=".8"/>' },
  brain: { also: ["the mind", "a thinker", "a processor", "the control centre", "thinking", "intelligence", "the cpu"], tint: "#f0a3b5", svg:
    '<rect class="d-t2" x="28" y="48" width="8" height="11" rx="3"/><g class="d-t"><circle cx="20" cy="20" r="10.5"/><circle cx="13.5" cy="31" r="8.5"/><circle cx="21" cy="42" r="10"/><circle cx="44" cy="20" r="10.5"/><circle cx="50.5" cy="31" r="8.5"/><circle cx="43" cy="42" r="10"/><ellipse cx="32" cy="31" rx="14" ry="19"/></g>' +
    '<path class="d-line thin" d="M32 12v12M22 13q-4 5 1 9M42 13q4 5-1 9M9 30q5 0 6 5M55 30q-5 0-6 5M19 47q4-1 4-5M45 47q-4-1-4-5" opacity=".45"/>' + face(33, 6) },
  lungs: { also: ["breathing", "bellows", "a pair of lungs", "respiration", "an air pump", "gas exchange"], tint: "#f09aa6", svg:
    '<path class="d-t" d="M27 16c-4 0-16 12-18 28-1 9 2 12 8 12 7 0 12-4 12-10V19q0-3-2-3zM37 16c4 0 16 12 18 28 1 9-2 12-8 12-7 0-12-4-12-10V19q0-3 2-3z"/>' +
    '<path class="d-t2" d="M9 44c-1 9 2 12 8 12 7 0 12-4 12-10-3 4-14 5-20-2zM55 44c1 9-2 12-8 12-7 0-12-4-12-10 3 4 14 5 20-2z"/>' +
    '<rect class="d-w2" x="29.5" y="5" width="5" height="21" rx="2.5"/><path class="d-line grey thick" d="M32 24l-9 10m4.5-5l-1 8M32 24l9 10m-4.5-5l1 8"/>' },
  cell: { also: ["a living cell", "a microbe", "a bacterium", "a unit", "a building block of life", "a tiny factory", "an organism"], tint: "#8fd6a4", svg:
    '<ellipse class="d-t2" cx="32" cy="32" rx="26" ry="25"/><ellipse class="d-t" cx="32" cy="32" rx="22.5" ry="21.5"/>' +
    '<circle class="d-pu" cx="28" cy="30" r="9.5"/><circle class="d-bl2" cx="30" cy="31.5" r="3.5"/>' +
    '<ellipse class="d-or" cx="45" cy="40" rx="5" ry="3" transform="rotate(-35 45 40)"/><ellipse class="d-or" cx="41" cy="19" rx="4" ry="2.5" transform="rotate(30 41 19)"/>' +
    '<circle class="d-t3" cx="21" cy="46" r="2.6"/><circle class="d-t3" cx="33" cy="48" r="1.8"/><circle class="d-t3" cx="47" cy="29" r="1.7"/><circle class="d-t3" cx="16" cy="24" r="1.7"/>' },
  dna: { also: ["a gene", "genes", "a blueprint", "a recipe", "instructions", "heredity", "a genetic code"], tint: "#b79cf0", svg:
    '<path class="d-y" d="M20 8h24v3H20zM20 53h24v3H20z"/><path class="d-pk" d="M24 13.500h16v3H24zM24 47.500h16v3H24z"/><path class="d-gr" d="M24 25h16v3H24zM24 36h16v3H24z"/><path class="d-bl" d="M20 30.500h24v3H20z"/>' +
    '<path class="d-t2" d="M48 6c0 12-27 14-27 26S48 46 48 58h-5.500c0-12-27-14-27-26S42.5 18 42.5 6z"/>' +
    '<path class="d-t" d="M16 6c0 12 27 14 27 26S16 46 16 58h5.500c0-12 27-14 27-26S21.5 18 21.5 6z"/>' },
  blocks: { also: ["counting blocks", "cubes", "building blocks", "units", "bricks", "a stack", "numbers"], tint: "#ee8f86", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="25" ry="2"/><rect class="d-t2" x="21" y="9" width="22" height="23" rx="3"/><rect class="d-t" x="21" y="9" width="22" height="18.5" rx="3"/>' +
    '<rect class="d-bl2" x="9" y="34" width="22" height="23" rx="3"/><rect class="d-bl" x="9" y="34" width="22" height="18.5" rx="3"/><rect class="d-y2" x="33" y="34" width="22" height="23" rx="3"/><rect class="d-y" x="33" y="34" width="22" height="18.5" rx="3"/>' +
    '<g class="d-w"><circle cx="32" cy="18" r="2.5"/><circle cx="16" cy="43" r="2.3"/><circle cx="24" cy="43" r="2.3"/><circle cx="39" cy="39.5" r="2.2"/><circle cx="44" cy="43.5" r="2.2"/><circle cx="49" cy="47.5" r="2.2"/></g>' },
  ruler: { also: ["a measure", "a length", "a scale", "a distance", "a straight edge", "a number line"], tint: "#f3c84b", svg:
    '<g transform="rotate(-30 32 32)"><rect class="d-t" x="5" y="23" width="54" height="18" rx="2.5"/><rect class="d-t2" x="5" y="36.5" width="54" height="4.5" rx="2"/>' +
    '<path class="d-line thin" d="M10 23.500v8M15.5 23.500v4.500M21 23.500v8M26.5 23.500v4.500M32 23.500v8M37.5 23.500v4.500M43 23.500v8M48.5 23.500v4.500M54 23.500v8"/></g>' },
  piechart: { also: ["a pie chart", "a fraction", "a share", "a percentage", "a proportion", "a slice", "market share"], tint: "#7fd08a", svg:
    '<circle class="d-t" cx="31" cy="33" r="24"/><path class="d-bl" d="M31 33l20.8 12a24 24 0 0 1-32.8 8.800z"/>' +
    '<path class="d-y" d="M34 30V6a24 24 0 0 1 20.8 36z"/>' },
  barchart: { also: ["a bar chart", "a graph", "data", "statistics", "a trend", "growth figures", "a histogram"], tint: "#7fbfe6", svg:
    '<rect class="d-t2" x="13" y="40" width="9" height="15" rx="1.5"/><rect class="d-t" x="25" y="31" width="9" height="24" rx="1.5"/><rect class="d-t3" x="37" y="22" width="9" height="33" rx="1.5"/><rect class="d-y" x="49" y="11" width="9" height="44" rx="1.5"/>' +
    '<path class="d-line grey" d="M7 8v48h52"/>' },
  dice: { also: ["a die", "chance", "probability", "a random number", "luck", "a gamble", "a game"], tint: "#e0564f", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="20" ry="2.2"/><path class="d-t3" d="M32 6l25 12-25 12-25-12z"/><path class="d-t" d="M7 18l25 12v27l-25-12z"/><path class="d-t2" d="M57 18l-25 12v27l25-12z"/>' +
    '<g class="d-w"><ellipse cx="32" cy="18" rx="4.5" ry="2.4"/><ellipse cx="13.5" cy="28.5" rx="2.5" ry="3.2"/><ellipse cx="25.5" cy="46.5" rx="2.5" ry="3.2"/>' +
    '<ellipse cx="38" cy="47" rx="2.3" ry="3"/><ellipse cx="44.5" cy="37.5" rx="2.3" ry="3"/><ellipse cx="51" cy="28" rx="2.3" ry="3"/></g>' },
  clock: { also: ["time", "a timer", "an hour", "a deadline", "a schedule", "a duration", "a stopwatch"], tint: "#5f86b3", svg:
    '<circle class="d-t2" cx="32" cy="33" r="26"/><circle class="d-t" cx="32" cy="32" r="26"/><circle class="d-w" cx="32" cy="32" r="20.5"/>' +
    '<path class="d-line thin" d="M32 14.500v4M32 45.500v4M14.5 32h4M45.5 32h4"/><path class="d-line thick" d="M32 32l8.5 5"/><path class="d-line" d="M32 32V19"/><circle class="d-rd" cx="32" cy="32" r="2.4"/>' },
};
