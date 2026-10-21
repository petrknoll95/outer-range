import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { z } from 'astro/zod';
import { MIN_PROJECT_IMAGES } from './canvas/projects';

/**
 * Projects, each a group of canvas images. Per-entry rules live in the schema; the rules
 * across entries (every image in exactly one project, files that exist) are checked by
 * resolveProjects when the page is built.
 */
const projects = defineCollection({
  loader: file('src/content/projects.json'),
  schema: z.object({
    title: z.string().min(1),
    year: z.number().int().optional(),
    images: z.array(z.string().regex(/\.jpg$/)).min(MIN_PROJECT_IMAGES),
  }),
});

export const collections = { projects };
