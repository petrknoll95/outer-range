import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { media as manifest } from '../src/assets/media';
import projectsJson from '../src/content/projects.json';
import { resolveImages } from '../src/canvas/images';
import type { ProjectEntry } from '../src/canvas/projects';
import { createProjectIndex, MIN_PROJECT_IMAGES, resolveProjects } from '../src/canvas/projects';
import { readImageEntries } from './entries';

// Image ids in manifest order, as the page resolves them.
const ids = resolveImages(
  readImageEntries(),
  manifest.map((m) => m.file),
).map((e) => e.id);
const entries = projectsJson as ProjectEntry[];

describe('src/content/projects.json', () => {
  const projects = resolveProjects(entries, ids);

  it(`puts every image in exactly one project of at least ${MIN_PROJECT_IMAGES}`, () => {
    const all = projects.flatMap((p) => p.images).sort((a, b) => a - b);
    expect(all).toEqual(ids.map((_, n) => n));
    for (const p of projects) expect(p.images.length).toBeGreaterThanOrEqual(MIN_PROJECT_IMAGES);
  });

  it('uses unique, URL-safe ids', () => {
    const ids = projects.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe('resolveProjects', () => {
  const images = ['a', 'b', 'c', 'd', 'e', 'f'];
  const ok: ProjectEntry[] = [
    { id: 'one', title: 'One', images: ['a', 'b', 'c'] },
    { id: 'two', title: 'Two', year: 2024, images: ['f', 'e', 'd'] },
  ];

  it('maps image ids to image indices, keeping project order (cover first)', () => {
    expect(resolveProjects(ok, images)).toEqual([
      { id: 'one', title: 'One', images: [0, 1, 2] },
      { id: 'two', title: 'Two', year: 2024, images: [5, 4, 3] },
    ]);
  });

  it('rejects every broken rule, listing them all at once', () => {
    const broken: ProjectEntry[] = [
      { id: 'one', title: 'One', images: ['a', 'b'] },
      { id: 'one', title: 'Again', images: ['b', 'c', 'c', 'x'] },
    ];
    let message = '';
    try {
      resolveProjects(broken, images);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('"one" is used twice');
    expect(message).toContain('has 2 images');
    expect(message).toContain('"b" is in both "one" and "one"');
    expect(message).toContain('"c" is in both "one" and "one" (twice)');
    expect(message).toContain('"x", which is not an image in src/content/images');
    expect(message).toContain('3 images belong to no project: d, e, f');
  });
});

describe('createProjectIndex', () => {
  const projects = resolveProjects(entries, ids);
  const index = createProjectIndex(projects, ids.length);

  it('finds each image’s project and its siblings, in project order', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: ids.length - 1 }), (image) => {
        const project = projects[index.projectOf(image)]!;
        expect(project.images).toContain(image);
        const siblings = index.siblings(image);
        expect(siblings).not.toContain(image);
        expect(siblings).toEqual(project.images.filter((n) => n !== image));
      }),
      { numRuns: 500 },
    );
  });

  it('looks projects up by id, and knows nothing about images it was not given', () => {
    expect(index.byId(projects[0]!.id)).toBe(projects[0]);
    expect(index.byId('no-such-project')).toBeUndefined();
    expect(index.projectOf(ids.length + 5)).toBe(-1);
    expect(index.siblings(-1)).toEqual([]);
  });
});
