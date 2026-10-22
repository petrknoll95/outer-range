import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { media as manifest } from '../src/assets/media';
import type { ImageEntry } from '../src/canvas/images';
import { CATEGORIES, ID_PATTERN, resolveImages } from '../src/canvas/images';
import { readImageEntries } from './entries';

const files = manifest.map((m) => m.file);

describe('src/content/images', () => {
  const entries = readImageEntries();
  const content = resolveImages(entries, files);

  it('describes every manifest image exactly once, in manifest order', () => {
    expect(content.map((e) => e.file)).toEqual(files);
    expect(content.length).toBe(entries.length);
  });

  it('gives every image a title, one of the categories and alt text', () => {
    for (const e of content) {
      expect(e.title.trim(), e.id).not.toBe('');
      expect(CATEGORIES, e.id).toContain(e.category);
      expect(e.alt.trim().length, e.id).toBeGreaterThan(0);
      expect(e.alt.length, e.id).toBeLessThanOrEqual(200);
    }
  });

  it('uses every category', () => {
    for (const category of CATEGORIES) expect(content.some((e) => e.category === category), category).toBe(true);
  });
});

describe('resolveImages', () => {
  const entry = (id: string, file: string): ImageEntry => ({ id, file, title: id, category: 'Brand', alt: id });
  const images = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'];

  it('returns entries in manifest order, however they are listed', () => {
    const all = images.map((file, n) => entry(`image-${n}`, file));
    fc.assert(
      fc.property(fc.shuffledSubarray(all, { minLength: all.length }), (shuffled) => {
        expect(resolveImages(shuffled, images).map((e) => e.id)).toEqual(all.map((e) => e.id));
      }),
    );
  });

  it('rejects every broken rule, listing them all at once', () => {
    const broken = [
      entry('one', 'a.jpg'),
      entry('two', 'a.jpg'),
      entry('Not_Slug', 'b.jpg'),
      entry('three', 'x.jpg'),
    ];
    let message = '';
    try {
      resolveImages(broken, images);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('"a.jpg" is described by both "one" and "two"');
    expect(message).toContain('Image id "Not_Slug" is not lowercase words joined by hyphens');
    expect(message).toContain('Image "three" has file "x.jpg", which is not in the image manifest');
    expect(message).toContain('2 images have no entry in src/content/images: c.jpg, d.jpg');
  });

  it('accepts exactly the ids an entry file can be named', () => {
    for (const id of ['a', 'ghia-fridge', 'v2-render']) expect(id).toMatch(ID_PATTERN);
    for (const id of ['', 'A', 'a--b', '-a', 'a-', 'a_b', 'a b']) expect(id).not.toMatch(ID_PATTERN);
  });
});
