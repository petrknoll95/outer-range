// Add the seven silent project reels without replacing existing media.
// Preserves the native 16:9 frame without cropping or padding, with standard delivery copies.
// Usage: node scripts/videos/build-project-reels.mjs [folder of project MP4s]
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {gridSize,pixelGrid} from '../pixels/pixel-grid.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const folder=process.argv[2]??`${homedir()}/Documents/Design/OM2026 Video 3D/Project Loops`;
const clips=[['01_Resonant','resonant'],['02_Hanover_Park','hanover-park'],['03_Perceptron','perceptron'],['04_Ditto','ditto'],['05_Utility','utility'],['07_Flex','flex'],['08_Superintelligent','superintelligent']];
for(const [name,project] of clips){
const source=`${folder}/${name}.mp4`;
const out=`${root}src/assets/videos/`,id=`${project}-reel`;
/** The frame for the poster: half a second into each project clip. */
const POSTER=0.5;
const run=args=>execFileSync('ffmpeg',['-v','error','-y','-i',source,...args],{stdio:'inherit'});
for(const [suffix,w,h] of [['',1920,1080],['-small',640,360]]){
 const common=['-vf',`scale=${w}:${h}:flags=lanczos`,'-an','-r','30','-pix_fmt','yuv420p','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709'];
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
 grid:gridSize(1920,1080),width:1920,height:1080,
 color:'#'+[dominant.r,dominant.g,dominant.b].map(n=>n.toString(16).padStart(2,'0')).join(''),
 pixels:await pixelGrid(`${out}${poster}`,gridSize(1920,1080)),duration,
 source:`OM2026 Video 3D/Project Loops/${name}.mp4`,
};
const manifestPath=`${out}manifest.json`;
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const previous=manifest.findIndex(m=>m.file===entry.file);
if(previous<0)manifest.push(entry);else manifest[previous]=entry;
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(`Added ${id} to the video manifest.`);
}
