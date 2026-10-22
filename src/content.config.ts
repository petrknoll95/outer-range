import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { CATEGORIES, ID_PATTERN } from './canvas/images';
import { MIN_PROJECT_IMAGES } from './canvas/projects';

/**
 * Images and videos, one Markdown file each, named by the image's id (see src/canvas/images.ts). The
 * schema checks each entry; the rule across entries (every manifest image described
 * exactly once) is checked by resolveImages when the page is built.
 */
const images = defineCollection({
  loader: glob({ pattern: '*.md', base: 'src/content/images' }),
  schema: z.object({
    file: z.string().regex(/\.(jpg|webp|mp4)$/),
    title: z.string().trim().min(1).max(80),
    category: z.enum(CATEGORIES),
    alt: z.string().trim().min(1).max(200),
    caption: z.string().trim().max(160).optional(),
    notes: z.string().trim().optional(),
  }),
});

/**
 * Projects, each a group of canvas images. Per-entry rules live in the schema; the rules
 * across entries (every image in exactly one project, ids that exist) are checked by
 * resolveProjects when the page is built.
 */
const projects = defineCollection({
  loader: file('src/content/projects.json'),
  schema: z.object({
    title: z.string().min(1),
    year: z.number().int().optional(),
    images: z.array(z.string().regex(ID_PATTERN)).min(MIN_PROJECT_IMAGES),
  }),
});

export const collections = { images, projects };
