/**
 * The fold marker on a My Space card's header, shared by the four boxes and
 * the notepad so every panel on the page folds the same way.
 *
 * Rotated rather than swapped for a second glyph: the turn is what reads as
 * opening, and a card whose marker only ever points one way looks like a
 * decoration instead of a control.
 */
export function CardChevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 text-xs text-muted transition-transform duration-[120ms] ${
        open ? "rotate-90" : ""
      }`}
    >
      ▸
    </span>
  );
}
