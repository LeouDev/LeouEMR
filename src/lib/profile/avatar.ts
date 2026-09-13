/**
 * Profile pictures: what the panel sends and what the row keeps. The
 * browser resizes the chosen photo to a 256px square before upload, so
 * the server only ever sees a small image — but it still checks, since a
 * data URL is just a string anyone can post.
 */

/** The square the browser resizes to; twice that on a retina screen is plenty for a 56px avatar. */
export const AVATAR_SIZE = 256;
/** Decoded bytes. A 256px WebP is 10–30 KB; a PNG of the same is well under this. */
export const MAX_AVATAR_BYTES = 200_000;
export const AVATAR_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];

export const AVATAR_TOO_LARGE = "That picture is too large — try a smaller photo.";
export const AVATAR_NOT_AN_IMAGE = "Choose a PNG, JPEG or WebP picture.";

export interface ParsedAvatar {
  contentType: AvatarType;
  /** Base64 without the data: prefix, as stored. */
  base64: string;
  bytes: number;
}

/** Reads a `data:image/…;base64,…` URL; null for anything that is not a small raster image. */
export function parseAvatarDataUrl(dataUrl: unknown): ParsedAvatar | null {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) return null;
  const contentType = match[1] as AvatarType;
  const base64 = match[2];
  if (base64.length % 4 !== 0) return null;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = (base64.length * 3) / 4 - padding;
  if (bytes <= 0 || bytes > MAX_AVATAR_BYTES) return null;
  return { contentType, base64, bytes };
}

/** The picture's URL for this version; the route caches for a year, so a new upload needs a new URL. */
export function avatarUrl(version: number): string {
  return `/profile/avatar?v=${version}`;
}
