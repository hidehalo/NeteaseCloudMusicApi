import { DownloaderHelper, ErrorStats, DownloadEvents } from 'node-downloader-helper';
import { ResolvedSong } from './resolver'
import getDownloadUrl from '../../module/song_download_url';
import { StaticIpRequest } from '../http';
import { ServerContext } from '../context';
import fs from 'fs';
import path from 'path';


interface HttpEntity {
  method: 'GET'|'POST'
  url: string
  headers?: object
  cookie: object
}

interface EventHandler extends DownloadEvents {}

function parseExtension(url: string): string {
  const basename = path.basename(url);
  const firstDot = basename.indexOf('.');
  const lastDot = basename.lastIndexOf('.');
  const extname = path.extname(basename).replace(/(\.[a-z0-9]+).*/i, '$1');

  if (firstDot === lastDot) {
    return extname;
  }

  return basename.slice(firstDot, lastDot) + extname;
}

class SongDownloader {

  async download(context: ServerContext, rootPath: string, resolvedSong: ResolvedSong, eventHandler: EventHandler): Promise<boolean | void> {
    const request = new StaticIpRequest(context, resolvedSong.query.ip);
    let downloadResp = await getDownloadUrl(resolvedSong.query, request.send.bind(request));
    const http = {
      method: 'GET',
      url: downloadResp.body.data.url,
      cookie: resolvedSong.query.cookie
    } as HttpEntity
    const cookieStr = Object.keys(http.cookie)
      .map((key): string => {
          type CookieKey = keyof typeof http.cookie;
          return `${encodeURIComponent(key)}=${encodeURIComponent(http.cookie[key as CookieKey])}`
      })
      .join('; ');

    const targetPath = `${rootPath}/${resolvedSong.artisans[0].name}/${resolvedSong.album.name}`;
    if (!fs.existsSync(targetPath)){
        fs.mkdirSync(targetPath, { recursive: true });
        context.logger.info(`创建目录 ${targetPath}`);
    }
    const dl = new DownloaderHelper(
      http.url, 
      targetPath,
      {
        headers: {
          Cookie: cookieStr
        },
        method: http.method,
        fileName: `${resolvedSong.song.name}${parseExtension(http.url)}`,
        override: {
          skip: true
        },
        timeout: 30 * 1e3/**30秒 */
      }
    );

    context.on('done', async () => {
      if (dl.getStats().progress < 100) {
        await dl.stop()
      }
    })

    dl.on('start', () => {
      context.logger.info(`开始下载歌曲 ${resolvedSong.song.name}`);
    })

    dl.on('skip', (stats) => {
      context.logger.info(`跳过下载 ${stats.filePath}`);
    });

    dl.on('stop', () => {
      context.logger.info('检测到中止信号，提前结束下载并删除文件');
    });

    if (eventHandler?.end) {
      dl.on('end', eventHandler?.end);
    }

    if (eventHandler?.error) {
      dl.on('error', eventHandler?.error);
    }

    const ok = await dl.start().catch(async (reason) => {
      context.logger.error(reason);
      return false;
    });
    
    return ok;
  }
}

export {
  HttpEntity,
  EventHandler,
  SongDownloader,
}
