/**
 * Start screen picture (SPEC §7.10): a tiny Track-mode Gantt drawn with the app's own tokens, so it teaches the bar
 * grammar before the first file: done fill, unfinished part, baseline, a late bar past its baseline ("+2d"), a not
 * started outline, a hollow milestone, FS arrows and the status-date line. Decorative; its own `art-*` classes keep
 * it out of the Gantt's `.mark` / `.bar-*` queries.
 */
export function StartArt() {
  return (
    <svg className="start-art" viewBox="0 0 300 132" width="300" height="132" aria-hidden="true" focusable="false">
      <rect className="art-head" width="300" height="20" />
      <path className="art-grid" d="M60.5 20V132M120.5 20V132M180.5 20V132M240.5 20V132M0 20.5H300M0 42.5H300M0 64.5H300M0 86.5H300M0 108.5H300" />
      <path className="art-tick" d="M60.5 12V20M120.5 12V20M180.5 12V20M240.5 12V20" />
      {/* completed */}
      <rect className="art-base" x="16" y="36" width="48" height="3" rx="1.5" />
      <rect className="art-done" x="16" y="24" width="48" height="10" rx="3" />
      {/* late: the forecast runs past the planned finish (x 168) */}
      <rect className="art-base" x="76" y="58" width="92" height="3" rx="1.5" />
      <rect className="art-late-rest" x="76.5" y="46.5" width="119" height="9" rx="3" />
      <rect className="art-late" x="76" y="46" width="24" height="10" rx="3" />
      <text className="art-label" x="207" y="51">
        +2d
      </text>
      {/* in progress */}
      <rect className="art-base" x="120" y="80" width="70" height="3" rx="1.5" />
      <rect className="art-prog-rest" x="120.5" y="68.5" width="69" height="9" rx="3" />
      <rect className="art-prog" x="120" y="68" width="30" height="10" rx="3" />
      {/* not started, then a not-started milestone */}
      <rect className="art-base" x="206" y="102" width="48" height="3" rx="1.5" />
      <rect className="art-idle-rest" x="206.5" y="90.5" width="47" height="9" rx="3" />
      <path className="art-ms" d="M266 114l5 5-5 5-5-5z" />
      {/* FS arrows */}
      <path className="art-link" d="M64 29H70V51H72M196 51H200V95H202M254 95H258V119H259" />
      <path className="art-head-arrow" d="M76 51l-4-3v6zM206 95l-4-3v6zM261 119l-4-3v6z" />
      {/* status date: halo, dashed line, chip */}
      <path className="art-sd-halo" d="M150 18V132" />
      <path className="art-sd" d="M150 18V132" />
      <rect className="art-sd-chip" x="126" y="2" width="48" height="16" rx="8" />
      <text className="art-sd-text" x="150" y="10.5">
        Status
      </text>
    </svg>
  );
}
