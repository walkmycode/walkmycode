// Shapes several drawings share: a person's shoulders, eyes and hair.

/** A person's shoulders in the drawing's colour, with what they wear at the neck drawn over them. */
export const person = (shirt: string) => `<path class="d-t" d="M10 64v-7c0-10 9-17 22-17s22 7 22 17v7z"/>${shirt}`;

/** Two eyes for a head centred at 32, 25. */
export const eyes = (r: number) => `<ellipse class="d-ink" cx="26.5" cy="26" rx="${r}" ry="${+(r * 1.3).toFixed(2)}"/><ellipse class="d-ink" cx="37.5" cy="26" rx="${r}" ry="${+(r * 1.3).toFixed(2)}"/>`;

/** Short hair over the top of a head centred at 32, 25 (radius 14). */
export const cap = '<path class="d-hr" d="M18 25c-1-10 5-16 14-16s15 6 14 16c-2-5-6-8-14-8s-12 3-14 8z"/>';

/** A grown-up's head and shoulders: `wear` is drawn over the shoulders, `top` over the hair (a hat, a crown). */
export const adult = (wear: string, top = "") =>
  person(`<rect class="d-sk2" x="28" y="33" width="8" height="9" rx="3"/>${wear}`) +
  `<circle class="d-sk" cx="32" cy="25" r="14"/>${cap}${top}${eyes(1.6)}` +
  '<path class="d-line smile" d="M27.5 32q4.5 4 9 0"/><path class="d-line frown" d="M27.5 35q4.5-4 9 0"/>';
