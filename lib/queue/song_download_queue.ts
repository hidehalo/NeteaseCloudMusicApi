import * as BullMQ from 'bullmq';
import { 
  EventHandler, SongDownloader,
  ResolvedSong, SongResolver,
  SongQuery, BatchSongQuery, 
  TrackResolver, TrackQuery
} from '../song';
import { ServerContext } from '../context';

export interface SongDownloadParams {
  songId: string
  downloadUrl: string
}

enum Status {
  Build = 0,
  Initiated,
  Started,
  Stopped,
  Closing,
  Closed
}

interface DownloadSongJobData {
  resolvedSong: ResolvedSong
}

class SongDownloadQueue {
  context: ServerContext;
  /**
   * @param {string}
   */
  queueName: string;

  concurrency: number;

  state: Status;

  queueDelegate?: BullMQ.Queue;

  worker?: BullMQ.Worker;

  songResolver: SongResolver;

  songDownloader: SongDownloader;

  trackResolver: TrackResolver;

  /**
   * @param {string} queueName - 队列名称
   */
  constructor(context: ServerContext, queueName: string, concurrency: number = 4) {
    this.context = context;
    this.queueName = queueName;
    this.concurrency = concurrency;
    this.state = Status.Build;
    this.songResolver = new SongResolver(this.context);
    this.trackResolver = new TrackResolver(this.context);
    this.songDownloader = new SongDownloader();
  }

  init() {
    if (this.state != Status.Build) {
      return;
    }
    this.queueDelegate = new BullMQ.Queue(this.queueName, {
      connection: {
        host: '127.0.0.1',
        port: 6379
      }
    });
    this.state = Status.Initiated;
  }

  private async addResolvedSongs(resolvedSongs: ResolvedSong[]) {
    let jobsBatch = [];
    for (let i = 0; i < resolvedSongs.length; i++) {
      let jobName = `download ${resolvedSongs[i].song.id}`;
      let jobData = {
        resolvedSong: resolvedSongs[i],
      } as DownloadSongJobData;
      jobsBatch.push({
        name: jobName,
        data: jobData
      });
    }
    await this.queueDelegate?.addBulk(jobsBatch);
  }

  async downloadSong(query: SongQuery) {
    let batchQuery = {
      ip: query.ip,
      ids: [query.id],
      cookie: query.cookie,
    } as BatchSongQuery;
    await this.downloadSongs(batchQuery);
  }

  async downloadSongs(query: BatchSongQuery) {
    let resolvedSongs = await this.songResolver.resolveBatch(query);
    await this.addResolvedSongs(resolvedSongs);
  }

  async downloadTrack(query: TrackQuery) {
    // let resolvedSongs = await this.trackResolver.resolve(query);
    let chunk = this.trackResolver.chunk(query);
    let resolvedSongs = [];
    do {
      resolvedSongs = await chunk.resolve();
      this.context.logger.info(`offset: ${chunk.query.offset} limit: ${chunk.query.limit}`)
      await this.addResolvedSongs(resolvedSongs)
      chunk = chunk.next();
    }
    while (resolvedSongs.length > 0);
  }

  getJobId(songId: string): string {
    return `${this.queueName}.download.${songId}`;
  }

  async handle(job: BullMQ.Job) {
    let jobData = job.data as DownloadSongJobData;
    const context = this.context;
    const eventHandler = {
      end: async (stat) => {
        let message = `${stat.filePath} 下载完成`;
        context.logger.info(message);
      },
      error: async (err) => {
        job.failedReason = err.message? err.message: '未知原因';
        throw new Error(err.message);
      }
    } as EventHandler;
    const done = await this.songDownloader.download(
      context,
      '/Users/TianChen/Music/网易云音乐', 
      jobData.resolvedSong, 
      eventHandler);
    if (!done) {
      context.logger.error(`歌曲 ${jobData.resolvedSong.song.name} 下载失败`)
    }
    return done;
  }

  onCompleted(job: BullMQ.Job, result: any, prev: string) {
    this.context.logger.info(`任务 ${job.id} 已完成`);
  }

  onFailed(job: BullMQ.Job, error: Error, prev: string) {
    this.context.logger.info(`任务 ${job.id} 已失败，原因是 ${job.failedReason}`);
  }

  onError(err: Error) {
    this.context.logger.error(err.message);
  }

  onProgress(job: BullMQ.Job, progress: number|object) {
    this.context.logger.info(progress);
  }
  
  async start() {
    this.context.logger.info("歌曲下载队列开始启动");
    if (this.state != Status.Initiated) {
      return;
    }

    if (!this.worker) {
      this.worker = new BullMQ.Worker(this.queueName, this.handle.bind(this), { 
        autorun: false,
        concurrency: this.concurrency,
        connection: {
          host: '127.0.0.1',
          port: 6379
        }
      });
      this.worker.on('completed', this.onCompleted.bind(this));
      this.worker.on('failed', this.onFailed.bind(this));
      this.worker.on('error', this.onError.bind(this));
      // this.worker.on('progress', this.onProgress.bind(this));
    }
    if (this.worker.isPaused()) {
      this.worker.resume();
    } else {
      this.context.logger.info("歌曲下载队列运行中...");
      this.worker.run();
    }
    this.state = Status.Started;
  }

  async stop() {
    if (this.state != Status.Started) {
      return;
    }
    await this.worker?.pause();
    this.state = Status.Initiated;
  }

  async close() {
    if (this.state != Status.Closed) {
      this.state = Status.Closing;
      // FIXME: 如果 worker 关闭了 queue 没关闭呢？
      return Promise.all([
        this.worker?.close(),
        this.queueDelegate?.close()
      ]).then(() => this.state = Status.Closed);
    }
  }
}

module.exports = {
  SongDownloadQueue: SongDownloadQueue,
  SongDownloadQueueStatus: Status,
}
