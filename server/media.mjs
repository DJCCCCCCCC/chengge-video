import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export async function probeMedia(file, config) {
  const { stdout } = await exec(config.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', file], { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
  const info = JSON.parse(stdout);
  const video = info.streams?.find(stream => stream.codec_type === 'video');
  const audio = info.streams?.filter(stream => stream.codec_type === 'audio') || [];
  if (!video || !Number.isFinite(Number(info.format?.duration)) || Number(info.format.duration) <= 0) throw new Error('INVALID_VIDEO');
  if (!['h264', 'vp8', 'vp9', 'av1'].includes(video.codec_name) || audio.some(stream => !['aac', 'mp3', 'opus', 'vorbis'].includes(stream.codec_name))) throw new Error('UNSUPPORTED_CODEC');
  return { duration: Number(info.format.duration), width: video.width || 0, height: video.height || 0 };
}
export async function makeCover(video, output, config) {
  await exec(config.ffmpeg, ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-threads', '2', '-ss', '0', '-i', video, '-frames:v', '1', '-vf', 'scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2', '-q:v', '3', '-y', output], { timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true });
}
