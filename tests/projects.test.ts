import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import manifest from '../src/assets/placeholders/manifest.json';
import projectsJson from '../src/content/projects.json';
import type { ProjectEntry } from '../src/canvas/projects';
import { createProjectIndex, MIN_PROJECT_IMAGES, resolveProjects } from '../src/canvas/projects';

const files = manifest.map((m) => m.file);
const entries = projectsJson as ProjectEntry[];

describe('src/content/projects.json', () => {
  const projects = resolveProjects(entries, files);

  it(`puts every image in exactly one project of at least ${MIN_PROJECT_IMAGES}`, () => {
    const all = projects.flatMap((p) => p.images).sort((a, b) => a - b);
    expect(all).toEqual(files.map((_, n) => n));
    for (const p of projects) expect(p.images.length).toBeGreaterThanOrEqual(MIN_PROJECT_IMAGES);
  });

  it('uses unique, URL-safe ids', () => {
    const ids = projects.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe('resolveProjects', () => {
  const images = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg', 'f.jpg'];
  const ok: ProjectEntry[] = [
    { id: 'one', title: 'One', images: ['a.jpg', 'b.jpg', 'c.jpg'] },
    { id: 'two', title: 'Two', year: 2024, images: ['f.jpg', 'e.jpg', 'd.jpg'] },
  ];

  it('maps files to image indices, keeping project order (cover first)', () => {
    expect(resolveProjects(ok, images)).toEqual([
      { id: 'one', title: 'One', images: [0, 1, 2] },
      { id: 'two', title: 'Two', year: 2024, images: [5, 4, 3] },
    ]);
  });

  it('rejects every broken rule, listing them all at once', () => {
    const broken: ProjectEntry[] = [
      { id: 'one', title: 'One', images: ['a.jpg', 'b.jpg'] },
      { id: 'one', title: 'Again', images: ['b.jpg', 'c.jpg', 'c.jpg', 'x.jpg'] },
    ];
    let message = '';
    try {
      resolveProjects(broken, images);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('"one" is used twice');
    expect(message).toContain('has 2 images');
    expect(message).toContain('"b.jpg" is in both "one" and "one"');
    expect(message).toContain('"c.jpg" is in both "one" and "one" (twice)');
    expect(message).toContain('"x.jpg", which is not in the image manifest');
    expect(message).toContain('3 images belong to no project: d.jpg, e.jpg, f.jpg');
  });
});

describe('createProjectIndex', () => {
  const projects = resolveProjects(entries, files);
  const index = createProjectIndex(projects, files.length);

  it('finds each image’s project and its siblings, in project order', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: files.length - 1 }), (image) => {
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
    expect(index.projectOf(files.length + 5)).toBe(-1);
    expect(index.siblings(-1)).toEqual([]);
  });
});
