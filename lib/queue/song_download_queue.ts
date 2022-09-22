import * as BullMQ from 'bullmq';
import { 
  SongDownloader, SongDownloadTaskStatus,
  ResolvedSong, SongResolver,
  SongQuery, BatchSongQuery, 
  TrackResolver, TrackQuery,
  
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

enum DownloadJobStatus {
  Pending = 0,
  Succeed,
  Error,
  Cancel,
}

interface JobResult {
  state: DownloadJobStatus
  err?: Error
}

class SongDownloadQueue {

  context: ServerContext;

  queueName: string;

  concurrency: number;

  state: Status;

  queueDelegate?: BullMQ.Queue;

  worker?: BullMQ.Worker;

  consumer: Consumer;

  producer: Producer;

  /**
   * @param {string} queueName - 队列名称
   */
  constructor(context: ServerContext, queueName: string, concurrency: number = 4) {
    this.context = context;
    this.queueName = queueName;
    this.concurrency = concurrency;
    this.state = Status.Build;
    this.consumer = new Consumer(this);
    this.producer = new Producer(this);
  }

  private getRedisConnConfig(): BullMQ.ConnectionOptions {
      return {
        host: '127.0.0.1',
        port: 6379,
        enableOfflineQueue: false,
        enableAutoPipelining: true,
        lazyConnect: true,
      } as BullMQ.ConnectionOptions;
  }

  init() {
    if (this.state != Status.Build) {
      return;
    }
    this.queueDelegate = new BullMQ.Queue(this.queueName, {
      connection: this.getRedisConnConfig()
    });
    this.state = Status.Initiated;
    this.context.on('done', async () => await this.close())

    this.queueDelegate.on('cleaned', () => {
      this.context.logger.info('歌曲下载队列已清空');
    });
    this.queueDelegate.on('error', (err) => {
      this.context.logger.error('歌曲下载队列产生异常', [
        err
      ]);
    });
    this.queueDelegate.on('ioredis:close', () => {
      this.context.logger.warn('歌曲下载队列 Redis 连接已断开');
    });
    this.queueDelegate.on('paused', () => {
      this.context.logger.info('歌曲下载队列已暂停');
    });
    this.queueDelegate.on('waiting', (job) => {
      this.context.logger.info(`歌曲下载队列正在等待任务 ${job.id}`);
    });
    this.queueDelegate.on('removed', (job) => {
      this.context.logger.info(`歌曲下载队列移除任务 ${job.id}`);
    });
    this.queueDelegate.on('resumed', () => {
      this.context.logger.info(`歌曲下载队列已恢复运行`);
    });
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
    if (this.state != Status.Initiated) {
      return;
    }

    this.context.logger.info("歌曲下载队列开始启动");
    if (!this.worker) {
      this.worker = new BullMQ.Worker(this.queueName, this.consumer.handle.bind(this.consumer), {
        autorun: false,
        concurrency: this.concurrency,
        connection: this.getRedisConnConfig()
      });

      this.worker.on('closed', () => {
        this.context.logger.warn('worker closed');
      });

      this.worker.on('closing', () => {
        this.context.logger.warn('worker closing');
      });

      this.worker.on('paused', () => {
        this.context.logger.warn('worker paused');
      });

      this.worker.on('resumed', () => {
        this.context.logger.warn('worker resumed');
      });

      this.worker.on('completed', this.onCompleted.bind(this));
      this.worker.on('failed', this.onFailed.bind(this));
      this.worker.on('error', this.onError.bind(this));
      // this.worker.on('progress', this.onProgress.bind(this));
    }
    if (this.worker.isPaused()) {
      this.context.logger.info("歌曲下载队列恢复运行...");
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

    this.context.logger.info("歌曲下载队列停止运行");
    await this.worker?.pause();
    this.state = Status.Initiated;
  }

  async close() {
    if (this.state != Status.Closed) {
      this.context.logger.info("歌曲下载队列开始关闭");
      this.state = Status.Closing;

      return await Promise.all([
        this.worker?.close(),
        this.queueDelegate?.close()
      ]).then(() => {
        this.state = Status.Closed;
        this.context.logger.info("歌曲下载队列已关闭");
        return true;
      }).catch(() => {
        return false;
      });
    }
  }
}

class Consumer {

  context: ServerContext;

  queue: SongDownloadQueue;

  songDownloader: SongDownloader;

  constructor(queue: SongDownloadQueue) {
    this.queue = queue;
    this.context = new ServerContext(this.queue.context.logger);
    this.queue.context.on('done', () => this.context.emit('done'));
    this.songDownloader = new SongDownloader();
  }

  // getJobId(songId: string): string {
  //   return `${this.queue.queueName}.download.${songId}`;
  // }

  async handle(job: BullMQ.Job) {
    if (this.queue.state != Status.Started) {
      throw new Error('队列已关闭');
    }

    const handleContext = new ServerContext(this.context.logger);
    this.context.on('done', () => handleContext.emit('done'));

    const jobWorker = new Promise<JobResult>(async (resolve, reject) => {
      let result = {
        state: DownloadJobStatus.Pending
      } as JobResult;

      try {
        let jobData = job.data as DownloadSongJobData;
        const task = await this.songDownloader.download(
          handleContext,
          '/Users/TianChen/Music/NeteaseMusic', 
          jobData.resolvedSong);

        switch (task.state) {
          case SongDownloadTaskStatus.Downloaded:
            result.state = DownloadJobStatus.Succeed;
            break;
          default:
            if (task.err) {
              result.state = DownloadJobStatus.Error;
              result.err = task.err;
              job.failedReason = task.err.message;
            } else {
              result.state = DownloadJobStatus.Cancel;
              job.failedReason = task.getStateDescription();
            }
        }
      } catch (err) {
        result.state = DownloadJobStatus.Error;
        result.err = err as Error
      } finally {
        resolve(result);
      }
    })

    // BullMQ 有时候会 “卡住”，"active" 中的任务不断的刷新锁，但是不执行结束
    // 为了确保其它任务不会饿死，我们需要设置一个超时机制
    const timeoutTimer = new Promise<JobResult>((resolve, reject) => {
      let result = {
        state: DownloadJobStatus.Cancel
      } as JobResult;

      let wait = setTimeout(() => {
        handleContext.emit('done');
        clearTimeout(wait);
        job.failedReason = '执行任务超时';
        handleContext.logger.warn(`任务 ${job.id} 执行超时`)
        resolve(result)
      }, 120 * 1000/**微秒 */)
    })

    let run = Promise.race([
      jobWorker,
      timeoutTimer,
    ])

    const jobResult = await run;

    return jobResult.state == DownloadJobStatus.Succeed;
  }
}

class Producer {
  
  queue: SongDownloadQueue;

  context: ServerContext;

  songResolver: SongResolver;

  trackResolver: TrackResolver;

  constructor(queue: SongDownloadQueue) {
    this.queue = queue;
    this.context = new ServerContext(this.queue.context.logger);
    this.queue.context.on('done', () => this.context.emit('done'));
    this.songResolver = new SongResolver(this.context);
    this.trackResolver = new TrackResolver(this.context);
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
    await this.queue.queueDelegate?.addBulk(jobsBatch);
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
    // FIXME: 队列worker会假死
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
}

module.exports = {
  SongDownloadQueue: SongDownloadQueue,
  SongDownloadQueueStatus: Status,
}
