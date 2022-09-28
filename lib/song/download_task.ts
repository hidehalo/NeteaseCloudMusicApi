import { 
  DownloaderHelper, 
  DH_STATES, 
  DownloaderHelperOptions 
} from 'node-downloader-helper';
import { ResolvedSong } from './resolver'
import { ServerContext } from '../context';
import fs from 'fs';
import path from 'path';
import FileMD5Checksum from 'md5-file';

interface HttpEntity {
  method: 'GET'|'POST'
  url: string
  headers?: object
  cookie: object
}

enum SongDownloadTaskStatus {
  Waiting = 0,
  Downloading,
  Downloaded,
  Timeout,
  Error,
  Skipped,
  Cancel,
}

interface Tags {
  coverUrl: string
  title: string
  albumName: string
  trackNo: string
}

interface SongDownloadTaskParams {
  rootPath: string
  http: HttpEntity
  resolvedSong: ResolvedSong
  checksum: string
  totalSize: number
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

const DownloadTaskRunModeText = {
  [DownloadTaskRunMode.Resume]: '继续下载',
  [DownloadTaskRunMode.Restart]: '重新下载'
};

class SongDownloadTask {

  context: ServerContext;
  rootDir: string;
  http: HttpEntity;
  state: SongDownloadTaskStatus;
  dlState: DH_STATES;
  resolvedSong: ResolvedSong;
  err?: Error;
  checksum: string;
  totalSize: number;
  targetFileChecksumCache?: string;

  constructor(context: ServerContext, params: SongDownloadTaskParams) {
    this.context = context;
    this.state = SongDownloadTaskStatus.Waiting;
    this.dlState = DH_STATES.IDLE;
    this.http = params.http;
    this.rootDir = params.rootPath;
    this.resolvedSong = params.resolvedSong;
    this.checksum = params.checksum;
    this.totalSize = params.totalSize;
  }

  private getTargetDir(): string {
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

  private getFileName(): string {
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

  getTargetFileChecksum(fromCache: boolean = false): string {
    if (fromCache) {
      return this.targetFileChecksumCache? this.targetFileChecksumCache: '';
    }
    this.targetFileChecksumCache = FileMD5Checksum.sync(this.getTargetPath());
    return this.targetFileChecksumCache;
  }

  getTargetFileSize(): number {
    const fileStats = fs.statSync(this.getTargetPath());
    return fileStats.size;
  }

  private testChecksum(): boolean {
    if (!this.hasFileExists()) {
      return false;
    }
    let ck = this.getTargetFileChecksum();
    return this.checksum == ck;
  }

  private async startDownload(dlOptions: DownloaderHelperOptions): Promise<void> {
    const dl = new DownloaderHelper(
      this.http.url, 
      this.getTargetDir(),
      dlOptions,
    );
    this.dlState = DH_STATES.IDLE;
    let cancelContext = new ServerContext(this.context.logger);
    let cancelSignal = new Promise<boolean>((resolve) => {
      cancelContext.once('done', () => {
        this.context.logger.debug('下载器无法正确退出，强制释放')
        resolve(true)
      });
    });

    const stopDownload = async (): Promise<void> => {
      if (this.dlState != DH_STATES.PAUSED) {
        await dl.pause();
        cancelContext.emit('done');
      }
      // if (this.dlState != DH_STATES.STOPPED && this.hasFileExists()) {
      //   await dl.stop()
      // }
      // else {
      // }
    };

    this.context.once('done', async () => {
      const stats = dl.getStats();
      if (stats.downloaded < stats.total) {
        this.state = SongDownloadTaskStatus.Cancel;
        await stopDownload();
      }
    })

    dl.on('stateChanged', (state) => {
      this.context.logger.debug(`下载器状态由 ${this.dlState} 变更为 ${state}`);
      this.dlState = state;
    });

    dl.on('resume', (isResume: boolean) => {
      this.state = SongDownloadTaskStatus.Downloading;
      if (isResume) {
        this.context.logger.debug(`恢复下载歌曲『${this.resolvedSong.song.name}』`);
      } else {
        this.context.logger.error(`无法恢复下载歌曲『${this.resolvedSong.song.name}』`);
      }
    });

    dl.on('pause', () => {
      this.context.logger.debug(`暂停下载歌曲『${this.resolvedSong.song.name}』`);
    });

    dl.on('renamed', (stats) => {
      this.context.logger.debug(`歌曲『${this.resolvedSong.song.name}』被重命名为 ${stats.fileName}`);
    });

    dl.on('retry', (attempts, retry) => {
      this.context.logger.debug(`重试下载歌曲『${this.resolvedSong.song.name}』${attempts}/${retry.maxRetries}`);
    });

    dl.once('timeout', () => {
      this.state = SongDownloadTaskStatus.Timeout;
      this.context.logger.debug(`歌曲『${this.resolvedSong.song.name}』下载超时`, {
        url: this.http.url
      });
    });

    dl.once('download', (stats) => {
      this.state = SongDownloadTaskStatus.Downloading;
      this.context.logger.debug(`开始下载歌曲『${this.resolvedSong.song.name}』`);
    })

    dl.once('skip', (stats) => {
      this.state = SongDownloadTaskStatus.Skipped;
      this.context.logger.info(`跳过下载歌曲『${this.resolvedSong.song.name}』`);
    });

    dl.once('stop', async () => {
      this.context.logger.debug(`检测到中止信号，提前结束下载并删除歌曲『${this.resolvedSong.song.name}』`, {
        path: this.getTargetPath(),
        desc: this.getStateDescription(),
        error: this.err,
      });
      await stopDownload();
    });

    dl.once('end', (stats) => {
      if (!this.testChecksum()) {
        let message = `歌曲『${this.resolvedSong.song.name}』文件校验失败`;
        this.state = SongDownloadTaskStatus.Error;
        this.err = new Error(message);
        this.context.logger.error(message, {
          sourceUrl: this.http.url,
          sourceChecksum: this.checksum,
          targetPath: this.getTargetPath(),
          targetChecksum: this.getTargetFileChecksum(true),
        });
      } else {
        this.state = SongDownloadTaskStatus.Downloaded;
        this.context.logger.info(`歌曲『${this.resolvedSong.song.name}』下载完成`, {
          path: this.getTargetPath()
        });
      }
    })

    dl.on('error', async (err) => {
      this.err = new Error(err.message);
      this.state = SongDownloadTaskStatus.Error;
      await stopDownload();
    });

    const dlThread = dl.start()
      .catch(
        async (reason) => {
          this.state = SongDownloadTaskStatus.Error;
          this.err = new Error(reason);
          await stopDownload();
          return false;
      });

    const allThreads = [
      cancelSignal,
      dlThread
    ];

    await Promise.race(allThreads);

    let dlStats = dl.getStats();
    if (dlStats.downloaded != dlStats.total || 
      (
        this.dlState as DH_STATES != DH_STATES.FINISHED && 
        this.dlState as DH_STATES != DH_STATES.SKIPPED
      )
    ) {
      this.context.logger.error(`歌曲『${this.resolvedSong.song.name}』下载失败`);
    }
  }

  async run(mode: DownloadTaskRunMode = DownloadTaskRunMode.Restart): Promise<void> {
    this.context.logger.debug(`下载歌曲『${this.getFileName()}』任务运行在${DownloadTaskRunModeText[mode]}模式`);
    this.state = SongDownloadTaskStatus.Waiting;
    let dlOptions = {
      method: this.http.method,
      fileName: this.getFileName(),
      timeout: 300 * 1e3
    } as DownloaderHelperOptions;

    // TODO: 文件名如果太长需要做处理
    if (!fs.existsSync(this.getTargetDir())) {
      fs.mkdirSync(this.getTargetDir(), { recursive: true });
    }

    if (this.hasFileExists()) {
      if (this.testChecksum()) {
        this.state = SongDownloadTaskStatus.Skipped
        this.context.logger.info(`跳过下载歌曲『${this.resolvedSong.song.name}』`);
        return
      }
      // 1. 相等直接跳过
      // 2. 不相等，
      //  尺寸若大于等于传入的尺寸则覆盖
      //  尺寸若小于传入的尺寸则继续下载
      // 3. 下载完成后需要校验一次 checksum
      //  校验成功运行原有逻辑
      //  校验失败需要重新下载
      if (mode == DownloadTaskRunMode.Resume) {
        dlOptions.removeOnStop = false;
        dlOptions.removeOnFail = false;
        const fileStats = fs.statSync(this.getTargetPath());
        if (fileStats.size >= this.totalSize) {
          // 还是不要直接覆盖的好...有点危险
          // dlOptions.override = true;
          dlOptions.override = {
            skip: true,
          }
        } else {
          dlOptions.resumeIfFileExists = true;
          dlOptions.resumeOnIncomplete = true;
          dlOptions.forceResume = true;
        }
      } else {
        dlOptions.override = {
          skipSmaller: true
        };
      }
    }

    await this.startDownload(dlOptions);
  }
}

export {
  HttpEntity,
  SongDownloadTask,
  SongDownloadTaskStatus,
  SongDownloadTaskParams,
  DownloadTaskRunMode,
}
