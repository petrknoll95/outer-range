// Add the square TS turntable without rebuilding or deleting existing media.
// Capture source: Fitness/scripts/record-spin-server.mjs (720 frames, 60 fps).
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {gridSize,pixelGrid} from '../pixels/pixel-grid.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const source=`${root}art/ts-logo/ts-logo-spin-master.mp4`;
const out=`${root}src/assets/videos/`,id='ts-logo-spin';
const run=args=>execFileSync('ffmpeg',['-v','error','-y','-i',source,...args],{stdio:'inherit'});
for(const [suffix,size] of [['',1080],['-small',360]]){
 const common=['-vf',`scale=${size}:${size}:flags=lanczos`,'-an','-r','60','-pix_fmt','yuv420p','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709'];
 run([...common,'-c:v','libx264','-preset','slow','-crf','18','-movflags','+faststart',`${out}${id}${suffix}.mp4`]);
 run([...common,'-c:v','libvpx-vp9','-b:v','0','-crf','40','-row-mt','1','-cpu-used','2',`${out}${id}${suffix}.webm`]);
 console.log(`Encoded ${size} × ${size} MP4 and WebM`);
}
const poster=`${id}.jpg`;
run(['-frames:v','1','-q:v','1',`${out}${poster}`]);
const {dominant}=await sharp(`${out}${poster}`).stats();
const duration=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',source],{encoding:'utf8'}).trim());
const entry={
 file:`${id}.mp4`,webm:`${id}.webm`,small:`${id}-small.mp4`,smallWebm:`${id}-small.webm`,poster,
 grid:gridSize(1080,1080),width:1080,height:1080,
 color:'#'+[dominant.r,dominant.g,dominant.b].map(n=>n.toString(16).padStart(2,'0')).join(''),
 pixels:await pixelGrid(`${out}${poster}`,gridSize(1080,1080)),duration,
 source:'art/ts-logo/ts-logo-spin-master.mp4',
};
const manifestPath=`${out}manifest.json`;
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const previous=manifest.findIndex(m=>m.file===entry.file);
if(previous<0)manifest.push(entry);else manifest[previous]=entry;
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log('Added TS logo loop to the video manifest.');
