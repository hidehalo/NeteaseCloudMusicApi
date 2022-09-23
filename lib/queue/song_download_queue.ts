import * as BullMQ from 'bullmq';
import { 
  SongDownloader, SongDownloadTaskStatus,
  ResolvedSong, SongResolver,
  SongQuery, BatchSongQuery, 
  TrackResolver, TrackQuery,
  
} from '../song';
import { ServerContext } from '../context';
import os from 'os';

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

interface QueueParams {
  concurrency: number
  taskTimeoutMicroTs: number
}

class SongDownloadQueue {

  context: ServerContext;

  queueName: string;

  state: Status;

  queueDelegate?: BullMQ.Queue;

  queueSchd?: BullMQ.QueueScheduler;

  worker?: BullMQ.Worker;

  consumer: Consumer;

  producer: Producer;

  params: QueueParams;

  /**
   * @param {string} queueName - 队列名称
   */
  constructor(context: ServerContext, queueName: string, params: QueueParams) {
    this.context = new ServerContext(context.logger);
    context.once('done', () => this.context.emit('done'));
    this.queueName = queueName;
    this.params = params;
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

    this.initQueue();
    this.initScheduler();
    this.initWorker();
    this.state = Status.Initiated;
  }

  private initQueue() {
    if (this.queueDelegate) {
      return;
    }

    this.queueDelegate = new BullMQ.Queue(this.queueName, {
      connection: this.getRedisConnConfig(),
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    });
  }

  private initScheduler() {
    if (!this.queueSchd) {
      this.queueSchd = new BullMQ.QueueScheduler(this.queueName, {
        connection: this.getRedisConnConfig(),
        autorun: false,
      });
    }
  }

  private initWorker() {
    if (!this.worker) {
      // FIXME: 当队列中存在大量任务时，worker 完全不设置屏障的读取了大量的任务进行执行
      // 这可能会直接耗尽服务器的 socket 资源
      this.worker = new BullMQ.Worker(this.queueName, this.consumer.handle.bind(this.consumer), {
        autorun: false,
        concurrency: this.getConcurrency(),
        connection: this.getRedisConnConfig(),
        limiter: {
          max: this.getConcurrency(),
          duration: 1e3
        }
      });
      this.worker.on('completed', (job: BullMQ.Job, result: any, prev: string) => {
        this.context.logger.debug(`任务 ${job.id} 已完成`, {job: job.data.resolvedSong.song.name});
      });
      this.worker.on('failed', (job: BullMQ.Job, error: Error, prev: string) => {
        this.context.logger.debug(`任务 ${job.id} 已失败，原因是 ${job.failedReason}`, {job: job.data.resolvedSong.song.name});
      });
      this.worker.on('error', (err: Error) => {
        this.context.logger.error(err.message);
      });
    }
  }

  getConcurrency(): number {
    return this.params.concurrency? this.params.concurrency: os.cpus().length;
  }

  getTaskTimeout(): number {
    return this.params.taskTimeoutMicroTs? this.params.taskTimeoutMicroTs: 3e4;
  }
  
  async start() {
    if (this.state == Status.Build) {
      this.init();
    } else if (this.state != Status.Initiated) {
      return;
    }

    this.context.logger.debug("歌曲下载队列服务开始启动");
    let allThreads = [];
    if (this.worker?.isPaused()) {
      this.context.logger.debug("歌曲下载队列服务执行器恢复运行");
      this.worker.resume();
    } else {
      this.context.logger.debug("歌曲下载队列执行器服务运行中");
      allThreads.push(this.worker?.run());
    }

    if (!this.queueSchd?.isRunning()) {
      this.context.logger.debug("歌曲下载队列调度服务运行中");
      allThreads.push(this.queueSchd?.run());
    }

    this.state = Status.Started;
    this.context.once('done', async () => {
      await this.close();
    })
    await Promise.all(allThreads);
  }

  async close() {
    let oldState = this.state;
    if (this.state != Status.Closed && this.state != Status.Closing) {
      this.context.logger.debug("歌曲下载队列服务开始关闭");
      this.state = Status.Closing;
      this.context.emit('done');

      await Promise.all([
        this.worker?.close(),
        this.queueDelegate?.close(),
        this.queueSchd?.close()
      ]).catch(() => {
        this.state = oldState;
      });

      if (this.state != Status.Closing) {
      this.context.logger.debug("歌曲下载队列关闭失败");
        return false;
      }
      this.state = Status.Closed;
      this.context.logger.debug("歌曲下载队列执行器服务已关闭");
      this.context.logger.debug("歌曲下载队列调度器服务已关闭");
      this.context.logger.debug("歌曲下载队列服务已关闭");

      return true;
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
    this.queue.context.once('done', () => this.context.emit('done'));
    this.songDownloader = new SongDownloader();
  }

  // getJobId(songId: string): string {
  //   return `${this.queue.queueName}.download.${songId}`;
  // }

  async handle(job: BullMQ.Job) {
    if (this.queue.state != Status.Started) {
      throw new Error('队列已关闭');
    }
    
    this.context.logger.debug(`任务 ${job.id} 开始执行`, {
      job: job.data.resolvedSong.song.name
    });
    const handleContext = new ServerContext(this.context.logger);
    this.context.once('done', () => handleContext.emit('done'));

    const jobWorker = new Promise<JobResult>(async (resolve) => {
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
          case SongDownloadTaskStatus.Skipped:
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
    const timeoutTimer = new Promise<JobResult>((resolve) => {
      let result = {
        state: DownloadJobStatus.Cancel,
      } as JobResult;

      let wait = setTimeout(() => {
        handleContext.emit('done');
        clearTimeout(wait);
        job.failedReason = '执行超时';
        handleContext.logger.debug(`任务 ${job.id} 执行超时`, {
          job: job.data.resolvedSong.song.name
        });
        resolve(result)
      }, this.queue.getTaskTimeout())

      handleContext.once('done', () => clearTimeout(wait));
    })

    let run = Promise.race([
      jobWorker,
      timeoutTimer,
    ])

    const jobResult = await run;
    if (jobResult.state != DownloadJobStatus.Succeed) {
      if (jobResult.err) {
        throw jobResult.err;
      } else {
        throw new Error(job.failedReason)
      }
    }

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
    this.queue.context.once('done', () => this.context.emit('done'));
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
    // let resolvedSongs = await this.trackResolver.resolve(query);
    let chunk = this.trackResolver.chunk(query);
    let resolvedSongs = [];
    do {
      resolvedSongs = await chunk.resolve();
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
