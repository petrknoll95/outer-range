/**
 * Image content: one Markdown file per image in src/content/images/, named by the image's
 * id (a content collection, see src/content.config.ts). The frontmatter holds the fields
 * below; the body is an optional write-up. The id belongs to the entry, not the image file:
 * re-crop, re-export or replace the file and only `file` changes. Projects list images by id.
 */

export const CATEGORIES = ['Brand', 'Logo', 'Website', 'Development'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Lowercase words joined by hyphens: an entry's file name, and so its id. */
export const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** An image entry as authored. */
export interface ImageEntry {
  id: string;
  /** Image or video file name in the media list (src/assets/media.ts). */
  file: string;
  title: string;
  category: Category;
  /** What the image shows, for people who can't see it. The canvas sets it on every tile. */
  alt: string;
  /** One line about the image, for visitors. */
  caption?: string;
  /** Private. Never shipped to the page. */
  notes?: string;
}

/**
 * Resolve image entries against the manifest, checking what the page relies on: URL-safe
 * ids, and every manifest file described by exactly one entry. Returns the entries in
 * manifest order, so entry n describes image n. Throws one error listing every problem.
 */
export function resolveImages<T extends ImageEntry>(entries: readonly T[], files: readonly string[]): T[] {
  const problems: string[] = [];
  const known = new Set(files);
  const byFile = new Map<string, T>();

  for (const entry of entries) {
    if (!ID_PATTERN.test(entry.id)) problems.push(`Image id "${entry.id}" is not lowercase words joined by hyphens.`);
    if (!known.has(entry.file)) {
      problems.push(`Image "${entry.id}" has file "${entry.file}", which is not in the image manifest.`);
      continue;
    }
    const other = byFile.get(entry.file);
    if (other) {
      problems.push(`"${entry.file}" is described by both "${other.id}" and "${entry.id}".`);
      continue;
    }
    byFile.set(entry.file, entry);
  }

  const missing = files.filter((file) => !byFile.has(file));
  if (missing.length) problems.push(`${missing.length} images have no entry in src/content/images: ${missing.join(', ')}.`);
  if (problems.length) throw new Error(`Invalid images:\n- ${problems.join('\n- ')}`);
  return files.map((file) => byFile.get(file)!);
}
