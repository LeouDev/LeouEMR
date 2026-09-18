/**
 * The illustrated stand-in for someone who has not uploaded a profile
 * picture.
 *
 * One drawing, for everybody. The prototype carried two and chose between
 * them by a `gender` field; this app holds no such field on an employee or
 * a user, and the only thing available to guess one from is a person's
 * name — a guess wrong often enough that it would put the wrong drawing
 * beside somebody's name on a screen the whole company sees at sign-in,
 * with no way for them to correct it. Picking arbitrarily between two
 * gendered drawings avoided the guess but not the problem: half the roster
 * would still have been represented by the wrong one.
 *
 * A stand-in that is nobody in particular settles it. It also removes the
 * pick entirely, which is why there is no longer a hash here deciding
 * which face to draw.
 *
 * Anyone who would rather be represented by their own face already has the
 * way to do it: upload a profile picture, which the podium shows in
 * preference to this.
 */
export const PLACEHOLDER_FACE = "/podium/astronaut.webp";
