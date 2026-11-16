// The body and health: parts of the body, what makes it ill and what makes it better. Same hand as base.ts.
import type { DrawingSet } from "../types";

const EIGHT = [0, 45, 90, 135, 180, 225, 270, 315];
const BONE = (c: string, dy: number) =>
  `<g class="${c}"><rect x="15" y="${26 + dy}" width="34" height="12" rx="3"/><circle cx="14" cy="${25 + dy}" r="7"/><circle cx="14" cy="${39 + dy}" r="7"/><circle cx="50" cy="${25 + dy}" r="7"/><circle cx="50" cy="${39 + dy}" r="7"/></g>`;
const TOOTH = "M14 21C14 11 20 7 25 7C28 7 30 9 32 9S36 7 39 7C44 7 50 11 50 21C50 29 47 32 46 38L44 52Q43 56 40.5 56T37.5 52L36 43Q35 40 32 40T28 43L26.5 52Q26 56 23.5 56T20 52L18 38C17 32 14 29 14 21z";
const KIDNEY = "M24 7C12 7 7 19 7 32C7 46 13 57 25 57C33 57 37 51 35 45C34 41 30 39 30 32C30 25 34 23 35 19C37 13 33 7 24 7z";

export const BODY: DrawingSet = {
  virus: { also: ["a coronavirus", "an infection", "a disease", "a flu", "a cold", "a pathogen", "a contagion"], tint: "#e0697d", svg:
    '<ellipse class="d-sh" cx="32" cy="60" rx="16" ry="2"/>' +
    EIGHT.map((a) => `<g transform="rotate(${a} 32 31)"><rect class="d-t2" x="30.3" y="9" width="3.4" height="9"/><circle class="d-t" cx="32" cy="8.5" r="4.2"/></g>`).join("") +
    '<circle class="d-t2" cx="32" cy="31" r="16"/><circle class="d-t" cx="31" cy="30" r="14.6"/><ellipse class="d-t3" cx="24.5" cy="23.5" rx="3" ry="4.8" transform="rotate(40 24.5 23.5)"/>' +
    '<circle class="d-t2" cx="37.5" cy="35.5" r="2.6"/><circle class="d-t2" cx="26" cy="37" r="1.8"/>' },
  germ: { also: ["bacteria", "a single bacterium", "a microorganism", "a lurgy", "an infection", "a creepy crawly"], tint: "#6cc070", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="19" ry="2"/><g transform="translate(-1 4) rotate(-25 32 34)">' +
    '<path class="d-line tint" d="M21 29q-4-4-8-1t-8-1M20 34q-4-3-8 0t-8 0M21 39q-4 3-8 0t-8 1"/>' +
    '<rect class="d-t2" x="19" y="25" width="36" height="18" rx="9"/><rect class="d-t" x="19" y="25" width="36" height="15" rx="7.5"/><rect class="d-t3" x="26" y="28" width="16" height="3" rx="1.5"/>' +
    '<circle class="d-t2" cx="30" cy="35.5" r="2.2"/><circle class="d-t2" cx="40" cy="34.5" r="2.6"/><circle class="d-t2" cx="48" cy="37" r="1.6"/></g>' },
  tooth: { also: ["a molar", "teeth", "a dentist visit", "brushing teeth", "a filling", "a smile", "enamel"], tint: "#f4f5f7", svg:
    '<ellipse class="d-sh" cx="32" cy="59.5" rx="14" ry="2"/>' +
    `<path class="d-t2" d="${TOOTH}"/><path class="d-t" d="${TOOTH}" transform="translate(-1.6 -1) scale(1 .985)"/>` +
    '<path class="d-y" d="M54 2l1.5 4.5 4.5 1.5-4.5 1.5-1.5 4.5-1.5-4.5-4.5-1.5 4.5-1.5z"/>' },
  bone: { also: ["a skeleton", "a dog's bone", "a fossil", "calcium", "the skeleton", "a broken leg"], tint: "#f4ead8", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="22" ry="2"/><g transform="rotate(-35 32 32)">' + BONE("d-t2", 2.5) + BONE("d-t", 0) +
    '<rect class="d-w" x="18" y="28" width="26" height="2.6" rx="1.3"/><circle class="d-w" cx="11.5" cy="22.5" r="2.2"/></g>' },
  eye: { also: ["sight", "vision", "seeing", "looking", "watching", "an eyeball", "a viewer", "an observer"], tint: "#5f86b3", svg:
    '<path class="d-w" d="M3 32Q32 2 61 32Q32 62 3 32z"/><path class="d-w2" d="M8 37Q32 52 56 37Q32 58 8 37z"/>' +
    '<circle class="d-t2" cx="32" cy="32" r="12.5"/><circle class="d-t" cx="32" cy="32" r="10.5"/><circle class="d-ink" cx="32" cy="32" r="5.5"/><circle class="d-w" cx="36.5" cy="27.5" r="2.6"/><circle class="d-w" cx="28" cy="36" r="1.2"/>' +
    '<path class="d-line thick" d="M3 32Q32 2 61 32"/><path class="d-line thin" d="M5 33Q32 60 59 33"/><path class="d-line" d="M14 22.8l-3.5-4.5M22 18.7l-2-5M32 17v-5.5M42 18.7l2-5M50 22.8l3.5-4.5"/>' },
  ear: { also: ["hearing", "listening", "the ears", "the sense of hearing", "a listener", "noise", "an earful"], tint: "#e8b990", svg:
    '<path class="d-line net" d="M15 24q4 8 0 16M8.5 18.5q7 13.5 0 27"/>' +
    '<path class="d-t2" d="M22 28C22 14 31 5 42 5C53 5 59 13 59 25C59 35 52 39 49 45C46 52 44 59 34 59C28 59 24 55 24 50C24 46 27 44 26 39C25 35 22 33 22 28z"/>' +
    '<path class="d-t" d="M22 28C22 14 31 5 42 5C52 5 57 12 57 23C57 33 50 37 47 43C44 50 42 57 33 57C28 57 24 54 24 50C24 46 27 44 26 39C25 35 22 33 22 28z"/>' +
    '<path class="d-t2" d="M30 27C30 18 35 13 42 13C48 13 51 18 51 23C51 30 45 32 43 37C41 42 38 45 34.5 45C31 45 30.5 41 32 38C33.5 35 30 33 30 27z"/>' +
    '<path class="d-line tint thick" d="M35.5 39C39 33 45 30 44.5 24C44 19 38.5 18.5 36 22"/><ellipse class="d-t" cx="31" cy="37.5" rx="2.6" ry="3.6"/>' },
  hand: { also: ["touch", "waving", "five fingers", "a palm", "high five", "stop sign", "a helping hand"], tint: "#e8b990", svg:
    '<path class="d-line net" d="M51.5 9.5q3.5 3 4 7.5M55 4.5q5.5 4 6 11.5"/>' +
    '<rect class="d-t" x="9.3" y="27" width="7.5" height="21" rx="3.7" transform="rotate(-32 13 38)"/>' +
    '<g class="d-t"><rect x="16.5" y="12" width="7" height="26" rx="3.5"/><rect x="24.8" y="7" width="7" height="30" rx="3.5"/><rect x="33.1" y="9" width="7" height="28" rx="3.5"/><rect x="41.4" y="15" width="6.6" height="22" rx="3.3"/><rect x="16" y="28" width="32" height="27" rx="10"/></g>' +
    '<rect class="d-bl2" x="18" y="51" width="28" height="10" rx="2"/><rect class="d-bl" x="18" y="53.5" width="28" height="7.5" rx="2"/>' },
  stomach: { also: ["digestion", "the tummy", "the belly", "a gut", "hunger", "a stomach ache", "the digestive system"], tint: "#e58f6e", svg:
    '<rect class="d-t2" x="22" y="2" width="9" height="16" rx="3.5"/>' +
    '<path class="d-t2" d="M23 15C25 8 34 7 41 9C51 12 58 21 56 34C54 47 43 56 30 54C24 53 20 50 14 50H7V39H14C19 39 22 42 27 42C34 42 38 37 36 30C34 24 30 23 26 22C23 21 22 18 23 15z"/>' +
    '<path class="d-t" d="M23 15C25 8 34 7 41 9C51 12 57 20 55 32C53 43 43 50 31 49C25 48 20 46 14 46H7V39H14C19 39 22 42 27 42C34 42 38 37 36 30C34 24 30 23 26 22C23 21 22 18 23 15z"/>' +
    '<ellipse class="d-t3" cx="44" cy="17" rx="3.2" ry="5.5" transform="rotate(-40 44 17)"/><rect class="d-t2" x="5" y="38" width="4" height="13" rx="2"/>' },
  kidney: { also: ["the kidneys", "a blood filter", "filtering", "a kidney bean", "cleaning the blood", "urine", "a purifier"], tint: "#dd6f5e", svg:
    '<rect class="d-rd" x="28" y="24.5" width="31" height="4.5" rx="2.2"/><rect class="d-bl2" x="28" y="31.5" width="31" height="4.5" rx="2.2"/><path class="d-line yel thick" d="M31 39C40 42 44 49 44 61"/>' +
    `<path class="d-t2" d="${KIDNEY}"/><path class="d-t" d="${KIDNEY}" transform="translate(1.5 -1.2)"/>` +
    '<ellipse class="d-t3" cx="16.5" cy="22" rx="3" ry="6.5" transform="rotate(22 16.5 22)"/>' },
  muscle: { also: ["strength", "exercise", "strong", "a biceps", "the gym", "a flexed arm", "fitness", "a workout"], tint: "#e8b990", svg:
    '<path class="d-line yel" d="M14 21l-3-4.5M22.5 17.5v-5.5M31 20l3-4.5"/>' +
    '<path class="d-t" d="M5 41C9 34 15 28 24 28C32 28 36 32 38 36V22C38 18 40 16 42 16H50C52 16 53 18 53 22L55 46C55 54 49 58 43 58H9C6 58 5 56 5 53z"/>' +
    '<path class="d-t2" d="M12 46q13 4 25-6q-9 11-25 6z"/><path class="d-t2" d="M55 46C55 54 49 58 43 58H36Q49 55 51 40z"/><ellipse class="d-t3" cx="22" cy="33.5" rx="6.5" ry="2.8" transform="rotate(-8 22 33.5)"/>' +
    '<rect class="d-t" x="35" y="3" width="21" height="17" rx="6.5"/><g class="d-t2"><rect x="35" y="8" width="7" height="1.6" rx=".8"/><rect x="35" y="12.5" width="7" height="1.6" rx=".8"/><rect x="47" y="3" width="1.6" height="7" rx=".8"/></g>' +
    '<rect class="d-bl2" x="2" y="36" width="9" height="23" rx="2"/><rect class="d-bl" x="2" y="36" width="6.5" height="23" rx="2"/>' },
  syringe: { also: ["a vaccine", "an injection", "a jab", "a shot", "a needle", "an immunisation", "a booster"], tint: "#7fbfe6", svg:
    '<ellipse class="d-sh" cx="32" cy="60" rx="17" ry="2"/><g transform="rotate(-45 32 30)">' +
    '<rect class="d-w2" x="48" y="31.2" width="13" height="1.6" rx=".8"/><rect class="d-w2" x="43" y="28.5" width="6" height="7" rx="1.2"/>' +
    '<rect class="d-w2" x="5" y="29.5" width="12" height="5"/><rect class="d-w" x="3" y="23" width="4.5" height="18" rx="1.8"/>' +
    '<rect class="d-w3" x="17" y="23.5" width="27" height="17" rx="2.5"/><rect class="d-t" x="24" y="25.5" width="19" height="13" rx="1.2"/><rect class="d-t2" x="24" y="35" width="19" height="3.5" rx="1.2"/><rect class="d-dk" x="20" y="24.5" width="4" height="15" rx="1.2"/>' +
    '<rect class="d-w" x="15" y="18.5" width="4" height="27" rx="1.8"/><path class="d-line thin" d="M29 23.5v4.5M34 23.5v3M39 23.5v4.5"/></g>' },
  pill: { also: ["medicine", "a capsule", "a pill bottle", "painkillers", "a prescription", "a cure", "a remedy", "a dose"], tint: "#e0564f", svg:
    '<ellipse class="d-sh" cx="33" cy="58.5" rx="24" ry="2"/><g transform="rotate(-35 27 30)">' +
    '<path class="d-t" d="M29 22H17a8 8 0 0 0 0 16h12z"/><path class="d-w" d="M29 22h12a8 8 0 0 1 0 16H29z"/><path class="d-t2" d="M9.6 33H29v5H17a8 8 0 0 1-7.4-5z"/><path class="d-w2" d="M29 33h19.4A8 8 0 0 1 41 38H29z"/>' +
    '<rect class="d-t3" x="14" y="25" width="11" height="2.6" rx="1.3"/></g>' +
    '<circle class="d-w2" cx="46" cy="46.5" r="10.5"/><circle class="d-w" cx="46" cy="44.5" r="10.5"/><rect class="d-w2" x="38.5" y="43.5" width="15" height="2" rx="1"/>' },
  stethoscope: { also: ["a check-up", "a heartbeat check", "a chest check", "a medical exam", "a diagnosis", "a health check"], tint: "#5f86b3", svg:
    '<ellipse class="d-sh" cx="33" cy="59.5" rx="20" ry="2"/><g transform="translate(-1 -1) scale(1.3)">' +
    '<path class="d-line grey thick" d="M12 6C10 18 14 22 20 24C26 22 30 18 28 6"/><circle class="d-dk" cx="12" cy="5.5" r="2.3"/><circle class="d-dk" cx="28" cy="5.5" r="2.3"/>' +
    '<path class="d-line tint thick" d="M20 24V33c0 7 4 10 9 10s9-3 9-8"/><circle class="d-w2" cx="20" cy="24" r="2"/>' +
    '<circle class="d-w2" cx="38" cy="28" r="7.5"/><circle class="d-w" cx="38" cy="27.3" r="5.6"/><circle class="d-t" cx="38" cy="27.3" r="2.2"/></g>' },
  bandage: { also: ["a plaster", "a sticking plaster", "healing", "a cut", "a band-aid", "a graze", "a scraped knee"], tint: "#e8a36a", svg:
    '<ellipse class="d-sh" cx="32" cy="60" rx="18" ry="2"/><g transform="rotate(-40 32 31)">' +
    '<rect class="d-t2" x="4" y="23.5" width="56" height="20" rx="10"/><rect class="d-t" x="4" y="21.5" width="56" height="19" rx="9.5"/>' +
    '<rect class="d-w2" x="22" y="23.5" width="20" height="17" rx="2"/><rect class="d-w" x="22" y="23.5" width="20" height="14.5" rx="2"/>' +
    '<g class="d-t2"><circle cx="11" cy="28" r="1.2"/><circle cx="11" cy="34" r="1.2"/><circle cx="16" cy="31" r="1.2"/><circle cx="53" cy="28" r="1.2"/><circle cx="53" cy="34" r="1.2"/><circle cx="48" cy="31" r="1.2"/></g></g>' },
};
