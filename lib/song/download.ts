import { DownloaderHelper, DH_STATES, DownloadEvents } from 'node-downloader-helper';
import { ResolvedSong } from './resolver'
import getDownloadUrl from '../../module/song_download_url';
import getDownloadUrlNew from '../../module/song_url_v1';
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

enum DownloadTaskRunMode {
  Resume = 0,
  Restart,
}

class SongDownloadTask {

  context: ServerContext;
  rootDir: string;
  http: HttpEntity;
  state: SongDownloadTaskStatus;
  dlState?: DH_STATES;
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
    return fs.existsSync(this.getTargetPath());
  }

  getStateDescription(): string {
    return StatusDescription[this.state];
  }

  getTargetPath(): string {
    return `${this.getTargetDir()}/${this.getFileName()}`;
  }

  // TODO: 支持 resumeFromFile 模式
  async run(mode: DownloadTaskRunMode = DownloadTaskRunMode.Restart) {
    this.state = SongDownloadTaskStatus.Waiting;
    if (this.hasFileExists()) {
      this.state = SongDownloadTaskStatus.Skipped
      return
    }

    // TODO: 文件名如果太长需要做处理
    if (!fs.existsSync(this.getTargetDir())) {
        fs.mkdirSync(this.getTargetDir(), { recursive: true });
    }

    const dl = new DownloaderHelper(
      this.http.url, 
      this.getTargetDir(),
      {
        method: this.http.method,
        fileName: this.getFileName(),
        // TODO: 动态配置 override
        override: {
          skip: true
        },
        timeout: 300 * 1e3
      }
    );
    this.dlState = DH_STATES.IDLE;

    this.context.once('done', async () => {
      const stats = dl.getStats();
      if (stats.downloaded < stats.total) {
        this.state = SongDownloadTaskStatus.Cancel;
        // TODO: 根据运行模式的不同，决定是否要删除文件
        if (this.dlState != DH_STATES.STOPPED && this.hasFileExists()) {
          await dl.stop()
        }
        // else dl.pause()
      }
    })

    dl.on('stateChanged', (state) => {
      this.context.logger.debug(`下载器状态由 ${this.dlState} 变更为 ${state}`);
      this.dlState = state;
    });

    dl.on('timeout', () => {
      this.state = SongDownloadTaskStatus.Timeout;
      this.context.logger.debug(`歌曲 『${this.resolvedSong.song.name}』 下载超时`, {
        url: this.http.url
      });
    });

    dl.on('download', (stats) => {
      this.state = SongDownloadTaskStatus.Downloading;
      this.context.logger.debug(`开始下载歌曲 『${this.resolvedSong.song.name}』`);
    })

    dl.on('skip', (stats) => {
      this.state = SongDownloadTaskStatus.Skipped;
      this.context.logger.debug(`跳过下载歌曲 『${this.resolvedSong.song.name}』`);
    });

    dl.on('stop', () => {
      this.context.logger.debug(`检测到中止信号，提前结束下载并删除歌曲 『${this.resolvedSong.song.name}』`, {
        path: this.getTargetPath(),
        desc: this.getStateDescription(),
        error: this.err,
      });
    });

    dl.on('end', (stats) => {
      this.state = SongDownloadTaskStatus.Downloaded;
      this.context.logger.info(`歌曲 『${this.resolvedSong.song.name}』 下载完成`, {
        path: this.getTargetPath()
      });
    })

    dl.on('error', async (err) => {
      this.err = new Error(err.message);
      this.state = SongDownloadTaskStatus.Error;
      // TODO: 同上
      if (this.dlState != DH_STATES.STOPPED && this.hasFileExists()) {
        await dl.stop();
      }
    });
    // TODO: 研究一下状态机的规则，是否只有 stop|end 状态会结束 `start()` 函数的阻塞？
    // 若是这样的话，可能需要一个AbortController 手动在一些中间状态取消下载任务
    await dl.start().catch((reason) => {
      this.state = SongDownloadTaskStatus.Error;
      this.err = new Error(reason);
      return false;
    });

    if (dl.getStats().downloaded != dl.getStats().total) {
      this.context.logger.error(`歌曲 『${this.resolvedSong.song.name}』 下载失败`);
    }
  }
}

class SongDownloader {

  async download(context: ServerContext, rootPath: string, resolvedSong: ResolvedSong) {
    const request = new StaticIpRequest(context, resolvedSong.query.ip);
    const http = {
      method: 'GET',
      cookie: resolvedSong.query.cookie
    } as HttpEntity
    let downloadResp = await getDownloadUrl(resolvedSong.query, request.send.bind(request));
    http.url = downloadResp.body.data.url;
    if (!http.url) {
      let newQuery = { ...resolvedSong.query } as any;
      newQuery.level = 'hires';
      // 有时 `getDownloadUrl` 无法成功获取，如果不同的 API 都无法得到下载地址
      // 那大概率是音乐资源被下架了... :)
      downloadResp = await getDownloadUrlNew(newQuery, request.send.bind(request));
      http.url = downloadResp.body.data[0]?.url;
    }

    const task = new SongDownloadTask(context, {
      http: http,
      rootPath: rootPath,
      resolvedSong: resolvedSong,
    })

    if (!http.url) {
      let errMsg = `歌曲 『${resolvedSong.song.name}』 无法解析下载地址`;
      context.logger.error(errMsg, {
        songId: resolvedSong.song.id,
        resp: downloadResp
      });
      task.state = SongDownloadTaskStatus.Error;
      task.err = new Error(errMsg);
      return task;
    }

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
