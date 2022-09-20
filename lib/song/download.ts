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
    const request = new StaticIpRequest(resolvedSong.query.ip);
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
        console.info(`Create directory ${targetPath}`);
    }
    // TODO: 处理 server 退出信号
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
        }
      }
    );

    context.on('done', async () => await dl.stop())

    dl.on('skip', (stats) => {
      console.info(`跳过下载 ${stats.filePath}`);
    });

    dl.on('stop', () => {
      console.info('检测到终止信号，提前结束下载');
    });

    if (eventHandler?.end) {
      dl.on('end', eventHandler?.end);
    }

    if (eventHandler?.error) {
      dl.on('error', eventHandler?.error);
    }

    return dl.start().catch((reason) => {
      console.error(reason);
    });
  }
}

export {
  HttpEntity,
  EventHandler,
  SongDownloader,
}
