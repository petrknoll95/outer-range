import type { Aspect } from '../canvas/world';
import images from './placeholders/manifest.json';
import videos from './videos/manifest.json';
import work from './work/manifest.json';

/** One piece of canvas media as built: an image, or a video shown over its poster frame. */
export interface MediaFile {
  /** The image or video file; content entries name it in `file`. */
  file: string;
  /** The still the tile shows and its variants are built from, as a path under src/assets: the image itself, or a video's poster frame. */
  still: string;
  aspect: Aspect;
  width: number;
  height: number;
  color: string;
  /** A video to play over the still, as a path under src/assets. */
  video?: string;
  /** Designed work (fine type, flat colour): its variants are served at a higher quality than photos'. */
  detail?: boolean;
}

/**
 * Everything on the canvas: the placeholder images (scripts/placeholders), the work images
 * (scripts/work), then the videos (scripts/videos), in the order the page and its content
 * entries resolve them.
 */
export const media: MediaFile[] = [
  ...images.map(({ file, aspect, width, height, color }) => ({ file, still: `placeholders/${file}`, aspect: aspect as Aspect, width, height, color })),
  ...work.map(({ file, aspect, width, height, color }) => ({ file, still: `work/${file}`, detail: true, aspect: aspect as Aspect, width, height, color })),
  ...videos.map(({ file, poster, aspect, width, height, color }) => ({
    file,
    still: `videos/${poster}`,
    video: `videos/${file}`,
    aspect: aspect as Aspect,
    width,
    height,
    color,
  })),
];
