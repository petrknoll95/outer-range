import type { Aspect } from '../canvas/world';
import images from './placeholders/manifest.json';
import videos from './videos/manifest.json';
import work from './work/manifest.json';

/** A video's copies: full size, and small for tiles drawn small, each as VP9 WebM and as H.264 MP4. */
export interface VideoCopies {
  webm: string;
  mp4: string;
  smallWebm: string;
  smallMp4: string;
}

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
  /** Its colour grid: the image pixelated, as hex digits run together (scripts/pixels). */
  pixels: string;
  /** A video to play over the still: its copies (see VideoCopies), as paths under src/assets. */
  video?: VideoCopies;
  /** Designed work (fine type, flat colour): its variants are served at a higher quality than photos'. */
  detail?: boolean;
}

/**
 * Everything on the canvas: the placeholder images (scripts/placeholders), the work images
 * (scripts/work), then the videos (scripts/videos), in the order the page and its content
 * entries resolve them.
 */
export const media: MediaFile[] = [
  ...images.map(({ file, aspect, width, height, color, pixels }) => ({ file, still: `placeholders/${file}`, aspect: aspect as Aspect, width, height, color, pixels })),
  ...work.map(({ file, aspect, width, height, color, pixels }) => ({ file, still: `work/${file}`, detail: true, aspect: aspect as Aspect, width, height, color, pixels })),
  ...videos.map(({ file, webm, small, smallWebm, poster, aspect, width, height, color, pixels }) => ({
    file,
    still: `videos/${poster}`,
    video: { webm: `videos/${webm}`, mp4: `videos/${file}`, smallWebm: `videos/${smallWebm}`, smallMp4: `videos/${small}` },
    aspect: aspect as Aspect,
    width,
    height,
    color,
    pixels,
  })),
];
