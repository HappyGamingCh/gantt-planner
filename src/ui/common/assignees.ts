// Adding typed assignee names (SPEC §4.3, §7.7): text is split on "," and ";" like the Assigned cell is read, so a
// pasted "ACME, ThermCo" gives two names, never one name with a comma that Save would add to Resources.
import { cleanName } from '../../excel/cells';

/**
 * `names` plus every name in `text` that isn't there yet (case-insensitive). A name matching a suggestion takes
 * the suggestion's spelling. Returns `names` itself when nothing is added.
 */
export function addNames(names: string[], text: string, suggestions: readonly string[]): string[] {
  const next = [...names];
  for (const part of text.split(/[,;]/).map(cleanName)) {
    if (part === '') continue;
    const name = suggestions.find((s) => s.toLowerCase() === part.toLowerCase()) ?? part;
    if (!next.some((n) => n.toLowerCase() === name.toLowerCase())) next.push(name);
  }
  return next.length === names.length ? names : next;
}
