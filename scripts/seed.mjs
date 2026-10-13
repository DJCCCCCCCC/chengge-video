import { initEnv } from './init.mjs';
import { config as loadEnv } from 'dotenv';
import { createApp } from '../server/app.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const exec = promisify(execFile);
initEnv(); loadEnv({ quiet: true });
const { db, config } = createApp();
const owner = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get().id;
const entries = [
  ['mountains', 'travel', '山野来信｜把时间交给远方', 'photo-1464822759023-fed622ff2c3b', '山间的光与影'],
  ['coast', 'travel', '海岸漫游：一场不赶时间的旅行', 'photo-1476514525535-07fb3b4ae5f1', '湖畔与远山'],
  ['camera', 'tech', '镜头里的世界，从一次按下快门开始', 'photo-1516035069371-29a1b244cc32', '相机静物'],
  ['forest', 'life', '去森林里，找回日常的呼吸', 'photo-1441974231531-c6227db76b6e', '森林光影'],
  ['music', 'music', '现场之外：关于音乐的片刻想象', 'photo-1516280440614-37939bbacd81', '舞台麦克风'],
  ['desk', 'creative', '一张桌子，和一些新想法', 'photo-1497215728101-856f4ea42174', '工作空间'],
  ['sky', 'knowledge', '抬头之后：夜空的另一种尺度', 'photo-1462331940025-496dfbfc7564', '星空影像'],
  ['city', 'travel', '城市切片｜在街头遇见另一种生活', 'photo-1519501025264-65ba15a82390', '城市建筑'],
];
const attribution = [];
try {
  for (const [slug, category, title, photo, subject] of entries) {
    const filename = `demo-${slug}.mp4`, cover = `demo-${slug}.jpg`;
    if (db.prepare('SELECT id FROM videos WHERE filename=?').get(filename)) continue;
    const coverPath = path.join(config.dataDir, 'covers', cover), videoPath = path.join(config.dataDir, 'videos', filename);
    const url = `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=1280&h=720&q=82`;
    if (!existsSync(coverPath)) {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Demo image unavailable: ${slug} (${response.status})`);
      await writeFile(coverPath, Buffer.from(await response.arrayBuffer()));
    }
    console.log(`Generating demo: ${slug}`);
    await exec(config.ffmpeg, ['-nostdin', '-v', 'error', '-loop', '1', '-i', coverPath, '-vf', "scale=960:540:force_original_aspect_ratio=increase,crop=960:540,zoompan=z='min(zoom+0.0004,1.1)':d=240:s=960x540:fps=24", '-t', '10', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-y', videoPath], { timeout: 120000, windowsHide: true });
    const size = (await stat(videoPath)).size;
    const description = `本地演示素材：由 Unsplash 的${subject}静态图片制作成 10 秒缓慢推近的视频，无音轨。用于测试播放、弹幕、评论与片单，不是 B 站视频或真实旅行记录。\n图片来源：${url}\n图片使用遵循 https://unsplash.com/license 。正式使用前请替换为你有权发布的作品。`;
    db.prepare('INSERT INTO videos(owner_id,category_id,title,description,filename,cover_filename,duration,size_bytes,width,height,is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,1)').run(owner, category, title, description, filename, cover, 10, size, 960, 540);
    attribution.push({ filename, photoUrl: url, license: 'https://unsplash.com/license', modification: 'Resized image and 10-second silent zoom animation' });
  }
  if (attribution.length) await writeFile(path.join(config.dataDir, 'demo-attribution.json'), JSON.stringify(attribution, null, 2));
  console.log('Demo library ready. All demo videos are labeled.');
} finally { db.close(); }
