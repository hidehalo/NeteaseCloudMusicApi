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

enum SongDownloadTaskStatus {
  Waiting = 0,
  Downloading,
  Downloaded,
  Timeout,
  Error,
  Skipped,
  Cancel,
}

interface SongDownloadTaskParams {
  rootPath: string
  http: HttpEntity
  resolvedSong: ResolvedSong
}

const StatusDescription = {
  [SongDownloadTaskStatus.Waiting]: '等待下载',
  [SongDownloadTaskStatus.Downloading]: '下载中',
  [SongDownloadTaskStatus.Downloaded]: '下载完成',
  [SongDownloadTaskStatus.Timeout]: '下载超时',
  [SongDownloadTaskStatus.Error]: '下载错误',
  [SongDownloadTaskStatus.Skipped]: '跳过下载',
  [SongDownloadTaskStatus.Cancel]: '取消下载',
};

class SongDownloadTask {

  context: ServerContext;
  rootDir: string;
  http: HttpEntity;
  state: SongDownloadTaskStatus;
  resolvedSong: ResolvedSong;
  err?: Error;

  constructor(context: ServerContext, params: SongDownloadTaskParams) {
    this.context = context;
    this.rootDir = params.rootPath;
    this.http = params.http;
    this.state = SongDownloadTaskStatus.Waiting;
    this.resolvedSong = params.resolvedSong;
  }

  getTargetDir(): string {
    // TODO: 文件名如果太长需要做处理
    let artisanNames = [];
    for (let i = 0; i < this.resolvedSong.artisans.length; i++) {
      artisanNames.push(this.resolvedSong.artisans[i].name);
    }
    return `${this.rootDir}/${artisanNames.join(',')}/${this.resolvedSong.album.name}`;
  }

  private parseExtension(url: string): string {
    const basename = path.basename(url);
    const firstDot = basename.indexOf('.');
    const lastDot = basename.lastIndexOf('.');
    const extname = path.extname(basename).replace(/(\.[a-z0-9]+).*/i, '$1');
  
    if (firstDot === lastDot) {
      return extname;
    }
  
    return basename.slice(firstDot, lastDot) + extname;
  }

  getFileName(): string {
    return `${this.resolvedSong.song.name}${this.parseExtension(this.http.url)}`
  }

  hasFileExists(): boolean {
    return fs.existsSync(`${this.getTargetDir()}/${this.getFileName}`);
  }

  getStateDescription(): string {
    return StatusDescription[this.state];
  }

  async run() {
    this.state = SongDownloadTaskStatus.Waiting;
    // TODO: 文件存在则不要开启sock
    if (this.hasFileExists()) {
      this.state = SongDownloadTaskStatus.Skipped
      return
    }

    // TODO: 文件名如果太长需要做处理
    if (!fs.existsSync(this.getTargetDir())) {
        fs.mkdirSync(this.getTargetDir(), { recursive: true });
    }

    const cookieStr = Object.keys(this.http.cookie)
      .map((key): string => {
          type CookieKey = keyof typeof this.http.cookie;
          return `${encodeURIComponent(key)}=${encodeURIComponent(this.http.cookie[key as CookieKey])}`
      })
      .join('; ');

    const dl = new DownloaderHelper(
      this.http.url, 
      this.getTargetDir(),
      {
        headers: {
          Cookie: cookieStr
        },
        method: this.http.method,
        fileName: this.getFileName(),
        override: {
          skip: true
        },
        timeout: 30 * 1e3/**30秒 */
      }
    );

    this.context.on('done', async () => {
      const stat = dl.getStats();
      if (stat.downloaded < stat.total) {
        console.log(stat);
        this.state = SongDownloadTaskStatus.Cancel;
        // FIXME: stop 会产生一个 unlink syscall，这时候文件或许并不存在
        // FIXME: stop twice maybe
        await dl.stop()
      }
    })

    dl.on('timeout', () => {
      this.state = SongDownloadTaskStatus.Timeout;
      this.context.logger.info(`歌曲 『${this.resolvedSong.song.name}』 下载超时`);
    });

    dl.on('start', () => {
      this.state = SongDownloadTaskStatus.Downloading;
      this.context.logger.info(`开始下载歌曲 ${this.resolvedSong.song.name}`);
    })

    dl.on('skip', (stats) => {
      this.state = SongDownloadTaskStatus.Skipped;
      this.context.logger.info(`跳过下载歌曲 『${this.resolvedSong.song.name}』`);
    });

    dl.on('stop', () => {
      this.context.logger.info(`检测到中止信号，提前结束下载并删除歌曲 『${this.resolvedSong.song.name}』`, {
        path: `${this.getTargetDir()}/${this.getFileName()}`,
        desc: this.getStateDescription(),
        error: this.err,
      });
    });

    dl.on('end', (stat) => {
      if (stat.incomplete) {
        this.state = SongDownloadTaskStatus.Error;
        this.context.logger.warn(`歌曲 『${this.resolvedSong.song.name}』 下载失败`);
      } else {
        this.state = SongDownloadTaskStatus.Downloaded;
        this.context.logger.info(`歌曲 『${this.resolvedSong.song.name}』 下载完成`, {
          path: `${this.getTargetDir()}/${this.getFileName()}`
        });
      }
    })

    dl.on('error', async (err) => {
      this.err = new Error(err.message);
      this.state = SongDownloadTaskStatus.Error;
      await dl.stop();
    });

    await dl.start().catch((reason) => {
      this.state = SongDownloadTaskStatus.Error;
      this.err = new Error(reason);
      return false;
    });
  }
}

class SongDownloader {

  async download(context: ServerContext, rootPath: string, resolvedSong: ResolvedSong) {
    const request = new StaticIpRequest(context, resolvedSong.query.ip);
    let downloadResp = await getDownloadUrl(resolvedSong.query, request.send.bind(request));
    const http = {
      method: 'GET',
      url: downloadResp.body.data.url,
      cookie: resolvedSong.query.cookie
    } as HttpEntity

    const task = new SongDownloadTask(context, {
      http: http,
      rootPath: rootPath,
      resolvedSong: resolvedSong,
    })

    await task.run();

    return task;
  }
}

export {
  HttpEntity,
  EventHandler,
  SongDownloader,
  SongDownloadTaskStatus
}
