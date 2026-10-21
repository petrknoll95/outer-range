import { readdirSync, readFileSync } from 'node:fs';
import type { ImageEntry } from '../src/canvas/images';

const DIR = new URL('../src/content/images/', import.meta.url);

/**
 * The image entries in src/content/images, read without Astro. Frontmatter values are one
 * line each, quoted ("…", as JSON) or plain; that is all the entries use.
 */
export function readImageEntries(): (ImageEntry & { body: string })[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const text = readFileSync(new URL(name, DIR), 'utf8');
      const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
      if (!match) throw new Error(`${name} has no frontmatter.`);
      const fields: Record<string, string> = {};
      for (const line of match[1]!.split('\n')) {
        const [, key, value] = /^(\w+):\s*(.*)$/.exec(line) ?? [];
        if (!key) throw new Error(`${name}: can't read frontmatter line "${line}".`);
        fields[key] = value!.startsWith('"') ? (JSON.parse(value!) as string) : value!.trim();
      }
      return { ...(fields as unknown as Omit<ImageEntry, 'id'>), id: name.slice(0, -3), body: match[2]!.trim() };
    });
}
