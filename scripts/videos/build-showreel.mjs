// Add the Off Menu showreel (the one on offmenu.design/services) without rebuilding or deleting existing media.
// Source: the om2026 repo, public/videos/showreel.mp4 (1920×1080, 30 fps, 40.6 s). Its footage runs to its
// edges, so it is set whole on white in a 4:3 tile, not cropped: the shape every tile had when it was built.
// The canvas now takes any ratio, so it could go in at 16:9 as it is.
// Usage: node scripts/videos/build-showreel.mjs [path to showreel.mp4]
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {gridSize,pixelGrid} from '../pixels/pixel-grid.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const source=process.argv[2]??`${homedir()}/Documents/GitHub/om2026/public/videos/showreel.mp4`;
const out=`${root}src/assets/videos/`,id='offmenu-showreel';
/** The white round it, each side, as a share of its width (scripts/work/build-work.mjs, INSET). */
const INSET=0.06;
/** The frame for the poster: the Off Menu mark that closes the reel. */
const POSTER=38;
const run=args=>execFileSync('ffmpeg',['-v','error','-y','-i',source,...args],{stdio:'inherit'});
for(const [suffix,w,h] of [['',1440,1080],['-small',480,360]]){
 const inner=2*Math.round(w/(1+2*INSET)/2);
 const common=['-vf',`scale=${inner}:-2:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:white`,'-an','-r','30','-pix_fmt','yuv420p','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709'];
 run([...common,'-c:v','libx264','-preset','slow','-crf','20','-movflags','+faststart',`${out}${id}${suffix}.mp4`]);
 run([...common,'-c:v','libvpx-vp9','-b:v','0','-crf','42','-row-mt','1','-cpu-used','2',`${out}${id}${suffix}.webm`]);
 console.log(`Encoded ${w} × ${h} MP4 and WebM`);
}
const poster=`${id}.jpg`;
execFileSync('ffmpeg',['-v','error','-y','-ss',String(POSTER),'-i',`${out}${id}.mp4`,'-frames:v','1','-q:v','1',`${out}${poster}`],{stdio:'inherit'});
const {dominant}=await sharp(`${out}${poster}`).stats();
const duration=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',source],{encoding:'utf8'}).trim());
const entry={
 file:`${id}.mp4`,webm:`${id}.webm`,small:`${id}-small.mp4`,smallWebm:`${id}-small.webm`,poster,
 grid:gridSize(1440,1080),width:1440,height:1080,
 color:'#'+[dominant.r,dominant.g,dominant.b].map(n=>n.toString(16).padStart(2,'0')).join(''),
 pixels:await pixelGrid(`${out}${poster}`,gridSize(1440,1080)),duration,
 source:'om2026/public/videos/showreel.mp4',
};
const manifestPath=`${out}manifest.json`;
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const previous=manifest.findIndex(m=>m.file===entry.file);
if(previous<0)manifest.push(entry);else manifest[previous]=entry;
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log('Added the Off Menu showreel to the video manifest.');
