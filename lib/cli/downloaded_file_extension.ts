import { SongRepository } from "../song";
import fs from 'fs';
import path from 'path';
import fileType from 'file-type';
import process from 'process';

async function fixFileExtension() {
  const repo = new SongRepository();
  let offset = 0;
  let limit = 1000;
  while (true) {
    let chunk = await repo.paginate(offset, limit, [
      'songId',
      'songName',
      'targetPath',
    ]);
    if (!chunk.length) {
      break;
    }
    offset += chunk.length;
    for (let songData of chunk) {
      if (!songData.targetPath) {
        continue;
      }
      const pathExt = path.extname(songData.targetPath);
      if (pathExt == '' || pathExt == '.data') {
        let readStream = fs.createReadStream(songData.targetPath);
        const binFileType = await fileType.fromStream(readStream);
        const binExt = binFileType?.ext;
        if (binExt) {
          const oldPath = songData.targetPath;
          const newExt = `.${binExt}`;
          let newPath = '';
          if (pathExt) {
            newPath = songData.targetPath.replace(pathExt, newExt);
          } else {
            newPath = songData.targetPath.trim() + newExt;
          }
          console.log('old', oldPath);
          console.log('new', newPath);
          fs.renameSync(oldPath, newPath);
          songData.targetPath = newPath;
          repo.upsert(songData);
          console.debug(`下载歌曲『${songData.songName}』文件扩展名校正成功`);
        } else {
          console.error(`下载歌曲『${songData.songName}』文件扩展名校正失败`, { binFileType });
        }
        readStream.close();
      }
    }
  }
  process.exit(0)
}

fixFileExtension()
