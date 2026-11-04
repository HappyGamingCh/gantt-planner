/** The app's diamond mark (SPEC §7.4). */
export function AppMark({ className = 'app-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1l7 7-7 7-7-7z" />
    </svg>
  );
}
