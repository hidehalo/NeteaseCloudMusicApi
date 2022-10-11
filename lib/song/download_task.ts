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
import process from 'process';

interface HttpEntity {
  method: 'GET'
  url: string
  headers?: object
  cookie: object
  checksum: string
  totalSize: number
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

interface MusicTags {
  coverUrl: string
  title: string
  albumName: string
  trackNo: string
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
    this.checksum = params.http.checksum;
    this.totalSize = params.http.totalSize;
  }

  private getTargetDir(): string {
    let artisanNames = [];
    for (let i = 0; i < 1; i++) {
      artisanNames.push(this.resolvedSong.artisans[i].name);
    }
    let dirBaseArtisan = artisanNames.join(',')?.replace(/\//g, ':');
    dirBaseArtisan = dirBaseArtisan? dirBaseArtisan: '未知艺术家';
    let dirBaseAlbum = this.resolvedSong.album.name?.replace(/\//g, ':');
    dirBaseAlbum = dirBaseAlbum? dirBaseAlbum: '未知专辑';
    return `${this.rootDir}/${dirBaseArtisan}/${dirBaseAlbum}`;
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
    return `${this.resolvedSong.song.name}${this.parseExtension(this.http.url)}`.replace(/\//g, ':');
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
    this.targetFileChecksumCache = '';
    if (this.hasFileExists()) {
      this.targetFileChecksumCache = FileMD5Checksum.sync(this.getTargetPath());
    }
    return this.targetFileChecksumCache;
  }

  getTargetFileSize(): number {
    if (this.hasFileExists()) {
      const fileStats = fs.statSync(this.getTargetPath());
      return fileStats.size;
    }
    return 0;
  }

  private testChecksum(): boolean {
    if (!this.hasFileExists()) {
      return false;
    }
    let ck = this.getTargetFileChecksum();
    return this.checksum == ck;
  }

  private async startDownload(dlOptions: DownloaderHelperOptions): Promise<void> {
    let startNanoTs = process.hrtime.bigint();
    let speedMax = 0;
    const dl = new DownloaderHelper(
      this.http.url, 
      this.getTargetDir(),
      dlOptions,
    );
    this.dlState = DH_STATES.IDLE;
    let cancelContext = new ServerContext(this.context.logger);
    let cancelSignal = new Promise<boolean>((resolve) => {
      cancelContext.once('done', () => resolve(true));
    });

    const stopDownload = async (): Promise<void> => {
      if (this.dlState == DH_STATES.DOWNLOADING ||
          this.dlState == DH_STATES.RETRY ||
          this.dlState == DH_STATES.RESUMED ||
          this.dlState == DH_STATES.SKIPPED ||
          this.dlState == DH_STATES.STARTED
        ) {
        await dl.pause().catch(() => false);
        cancelContext.emit('done');
      }
    };

    this.context.once('done', async () => {
      const stats = dl.getStats();
      if (stats.downloaded < stats.total) {
        this.state = SongDownloadTaskStatus.Cancel;
      }
      await stopDownload();
    });

    dl.on('progress', (stats) => {
      if (stats.speed > speedMax) {
        speedMax = stats.speed;
      }
    });

    dl.on('stateChanged', (state) => {
      this.context.logger.debug(`下载器状态由 ${this.dlState} 变更为 ${state}`);
      this.dlState = state;
    });

    let resumeRetryMax = 5;
    let resumeRetry = 0;
    dl.on('resume', async (isResume: boolean) => {
      this.state = SongDownloadTaskStatus.Downloading;
      if (isResume) {
        this.context.logger.debug(`恢复下载歌曲『${this.resolvedSong.song.name}』`);
      } else {
        if (resumeRetry >= resumeRetryMax) {
          await stopDownload();
          return;
        }
        resumeRetry++;
        this.context.logger.warn(`尝试恢复下载歌曲『${this.resolvedSong.song.name}』失败 ${resumeRetry}/${resumeRetryMax}`);
      }
    });

    dl.on('pause', () => {
      this.context.logger.debug(`暂停下载歌曲『${this.resolvedSong.song.name}』`);
    });

    dl.once('renamed', (stats) => {
      this.context.logger.debug(`歌曲『${this.resolvedSong.song.name}』被重命名为 ${stats.fileName}`);
    });

    dl.on('retry', (attempts, retry) => {
      this.context.logger.debug(`重试下载歌曲『${this.resolvedSong.song.name}』${attempts}/${retry.maxRetries}`);
    });

    dl.once('timeout', async () => {
      this.state = SongDownloadTaskStatus.Timeout;
      this.context.logger.debug(`歌曲『${this.resolvedSong.song.name}』下载超时`, {
        url: this.http.url
      });
      await stopDownload();
    });

    let lastDownloaded = 0;
    dl.once('download', (stats) => {
      startNanoTs = process.hrtime.bigint();
      lastDownloaded = dl.getStats().downloaded;
      this.state = SongDownloadTaskStatus.Downloading;
      this.context.logger.debug(`开始下载歌曲『${this.resolvedSong.song.name}』`);
    });

    dl.once('skip', async (stats) => {
      cancelContext.emit('done');
      this.state = SongDownloadTaskStatus.Skipped;
      this.context.logger.info(`跳过下载歌曲『${this.resolvedSong.song.name}』`);
      await stopDownload();
    });

    dl.once('stop', async () => {
      this.context.logger.debug(`检测到中止信号，结束下载歌曲『${this.resolvedSong.song.name}』`, {
        path: this.getTargetPath(),
        desc: this.getStateDescription(),
        error: this.err,
      });
      await stopDownload();
    });

    dl.once('end', async (stats) => {
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
        let endNanoTs = process.hrtime.bigint();
        let duration = endNanoTs - startNanoTs;
        this.state = SongDownloadTaskStatus.Downloaded;
        this.context.logger.info(`歌曲『${this.resolvedSong.song.name}』下载完成`, {
          path: this.getTargetPath(),
          duration: `${Number(duration.toString()) * 1e-9} S`,
          totalSize: `${dl.getStats().total*1e-6} MB`,
          speedMax: `${speedMax*1e-6} MB/S`,
          speedAvg: `${(dl.getStats().downloaded-lastDownloaded)*1e3/Number(duration.toString())} MB/S`
        });
      }
      await stopDownload();
    })

    dl.once('error', async (err) => {
      this.err = new Error(err.message);
      this.state = SongDownloadTaskStatus.Error;
      await stopDownload();
    });

    try {
      const dlThread = dl.start()
        .catch(
          async (reason) => {
            this.state = SongDownloadTaskStatus.Error;
            this.err = new Error(reason);
            await stopDownload();
            return false;
        }).finally(() => {
          cancelContext.emit('done');
          return this.dlState == DH_STATES.FINISHED;
        });

      const allThreads = [
        cancelSignal,
        dlThread
      ];

      await Promise.race(allThreads)
        .catch(async (reason) => {
          this.err = new Error(reason);
          this.state = SongDownloadTaskStatus.Error;
          await stopDownload();
        })
        .finally(() => cancelContext.emit('done'));
    } catch (e) {
      this.state = SongDownloadTaskStatus.Error;
      this.err = e as Error;
      await stopDownload();
    }

    let dlStats = dl.getStats();
    if (dlStats.downloaded != dlStats.total || 
      (
        this.dlState as DH_STATES != DH_STATES.FINISHED && 
        this.dlState as DH_STATES != DH_STATES.SKIPPED
      )
    ) {
      this.context.logger.error(`歌曲『${this.resolvedSong.song.name}』下载失败`, {
        songId: this.resolvedSong.song.id,
        err: this.err,
      });
    }
  }

  async run(mode: DownloadTaskRunMode = DownloadTaskRunMode.Restart): Promise<void> {
    this.context.logger.debug(`下载歌曲『${this.getFileName()}』任务运行在${DownloadTaskRunModeText[mode]}模式`);
    this.state = SongDownloadTaskStatus.Waiting;
    let dlOptions = {
      method: this.http.method,
      fileName: this.getFileName(),
      timeout: 120 * 1e3,
      retry: {
        maxRetries: 3,
        delay: 100,
      },
      progressThrottle: 3e3,
    } as DownloaderHelperOptions;

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
          dlOptions.resumeOnIncompleteMaxRetry = 5;
        }
      } else {
        dlOptions.override = {
          skipSmaller: true
        };
      }
    }

    await this.startDownload(dlOptions).catch((reason) => {
      this.state = SongDownloadTaskStatus.Error;
      this.err = new Error(reason);
    });
  }
}

export {
  HttpEntity,
  SongDownloadTask,
  SongDownloadTaskStatus,
  SongDownloadTaskParams,
  DownloadTaskRunMode,
}