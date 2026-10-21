/**
 * Projects group images: every image belongs to exactly one project, and a project's
 * images are its associations. Authored in src/content/projects.json (a content
 * collection, see src/content.config.ts), resolved against the image list at build time,
 * and shipped to the canvas as indices into CanvasData.images.
 */

/** Fewest images a project may have. */
export const MIN_PROJECT_IMAGES = 3;

/** A project as authored. `images` are file names from the placeholder manifest, cover first. */
export interface ProjectEntry {
  id: string;
  title: string;
  year?: number;
  images: readonly string[];
}

/** A project as the canvas receives it. `images` index CanvasData.images, cover first. */
export interface ClientProject {
  id: string;
  title: string;
  year?: number;
  images: number[];
}

/**
 * Resolve projects against the image list, checking what the canvas relies on: unique
 * ids, at least MIN_PROJECT_IMAGES images each, and every image in exactly one project.
 * Throws one error listing every problem.
 */
export function resolveProjects(entries: readonly ProjectEntry[], imageFiles: readonly string[]): ClientProject[] {
  const problems: string[] = [];
  const indexOf = new Map(imageFiles.map((file, n) => [file, n]));
  const owner = new Map<string, string>();
  const ids = new Set<string>();

  const projects = entries.map((entry) => {
    if (ids.has(entry.id)) problems.push(`Project id "${entry.id}" is used twice.`);
    ids.add(entry.id);
    if (entry.images.length < MIN_PROJECT_IMAGES) {
      problems.push(`Project "${entry.id}" has ${entry.images.length} images; it needs at least ${MIN_PROJECT_IMAGES}.`);
    }
    const images: number[] = [];
    for (const file of entry.images) {
      const index = indexOf.get(file);
      if (index === undefined) {
        problems.push(`Project "${entry.id}" lists "${file}", which is not in the image manifest.`);
        continue;
      }
      const other = owner.get(file);
      if (other !== undefined) {
        problems.push(`"${file}" is in both "${other}" and "${entry.id}"${other === entry.id ? ' (twice)' : ''}.`);
        continue;
      }
      owner.set(file, entry.id);
      images.push(index);
    }
    return { id: entry.id, title: entry.title, ...(entry.year === undefined ? {} : { year: entry.year }), images };
  });

  const orphans = imageFiles.filter((file) => !owner.has(file));
  if (orphans.length) problems.push(`${orphans.length} images belong to no project: ${orphans.join(', ')}.`);
  if (problems.length) throw new Error(`Invalid projects:\n- ${problems.join('\n- ')}`);
  return projects;
}

/** Lookups between images and their projects. */
export interface ProjectIndex {
  readonly projects: readonly ClientProject[];
  /** Index into `projects` of the project an image belongs to. */
  projectOf(image: number): number;
  /** The other images in the same project, in project order. */
  siblings(image: number): readonly number[];
  byId(id: string): ClientProject | undefined;
}

export function createProjectIndex(projects: readonly ClientProject[], imageCount: number): ProjectIndex {
  const of = new Int32Array(imageCount).fill(-1);
  projects.forEach((p, n) => {
    for (const image of p.images) of[image] = n;
  });
  const siblings = projects.map((p) => new Map(p.images.map((image) => [image, p.images.filter((other) => other !== image)])));
  const byId = new Map(projects.map((p) => [p.id, p]));
  return {
    projects,
    projectOf: (image) => of[image] ?? -1,
    siblings: (image) => {
      const n = of[image] ?? -1;
      return n < 0 ? [] : siblings[n]!.get(image)!;
    },
    byId: (id) => byId.get(id),
  };
}
