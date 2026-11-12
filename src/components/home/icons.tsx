// The few line icons of the home page and its sheets (docs/design/home-redesign.html).

export function LockIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function FolderIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** The lamp over the drop zone: a folder with the light inside. */
export function LampArt() {
  return (
    <svg viewBox="0 0 74 74" width="74" height="74" aria-hidden>
      <rect x="16" y="22" width="42" height="34" rx="9" fill="#2f2a25" stroke="#f3d77a" strokeOpacity=".55" strokeWidth="2" />
      <path d="M16 31h42" stroke="#f3d77a" strokeOpacity=".35" strokeWidth="2" />
      <path d="M16 22l7-8h15l5 6" fill="none" stroke="#f3d77a" strokeOpacity=".55" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="37" cy="43" r="6" fill="#f3d77a" />
    </svg>
  );
}
