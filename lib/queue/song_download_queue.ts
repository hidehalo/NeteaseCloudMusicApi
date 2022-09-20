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
    this.songResolver = new SongResolver();
    this.trackResolver = new TrackResolver();
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

  private addResolvedSongs(resolvedSongs: ResolvedSong[]) {
    let promises = [];
    for (let i = 0; i < resolvedSongs.length; i++) {
      let jobName = `download ${resolvedSongs[i].song.id}`;
      let jobData = {
        resolvedSong: resolvedSongs[i],
      } as DownloadSongJobData;
      let promise = this.queueDelegate?.add(jobName, jobData);
      promises.push(promise);
    }
    return Promise.all(promises);
  }

  async downloadSong(query: SongQuery) {
    let batchQuery = {
      ip: query.ip,
      ids: [query.id],
      cookie: query.cookie,
    } as BatchSongQuery;
    let resolvedSongs = await this.downloadSongs(batchQuery);
    return resolvedSongs[0];
  }

  async downloadSongs(query: BatchSongQuery) {
    let resolvedSongs = await this.songResolver.resolveBatch(query);
    return this.addResolvedSongs(resolvedSongs);
  }

  async downloadTrack(query: TrackQuery) {
    let resolvedSongs = await this.trackResolver.resolve(query);
    return this.addResolvedSongs(resolvedSongs);
  }

  getJobId(songId: string): string {
    return `${this.queueName}.download.${songId}`;
  }

  async handle(job: BullMQ.Job) {
    const eventHandler = {
      end: (stat) => {
        console.log(`${stat.filePath} 下载完成`);
        job.updateProgress(100);
      },
      error: (err) => {
        job.failedReason = err.message
      }
    } as EventHandler;
    let jobData = job.data as DownloadSongJobData;
    const done = await this.songDownloader.download(
      this.context,
      '/Users/tianchen/Music/网易云音乐', 
      jobData.resolvedSong, 
      eventHandler);
    if (!done) {
      console.error('下载失败');
    }
  }

  onCompleted(job: BullMQ.Job, result: any, prev: string) {
    console.log(job.id, 'compelted');
  }

  onFailed(job: BullMQ.Job, error: Error, prev: string) {
    console.log(error);
  }

  onProgress(job: BullMQ.Job, progress: number|object) {
    console.log(progress);
  }
  
  async start() {
    console.log("queue is bootstrapping");
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
      this.worker.on('progress', this.onProgress.bind(this));
    }
    if (this.worker.isPaused()) {
      this.worker.resume();
    } else {
      console.log("start to running...");
      this.worker.run().then((ret) => {console.log(ret)});
    }
    this.state = Status.Started;
    console.log("queue was bootstrapped");
  }

  async stop() {
    if (this.state != Status.Started) {
      return;
    }
    await this.worker?.pause();
    this.state = Status.Initiated;
  }

  async close() {
    this.state = Status.Closing;
    // FIXME: 如果 worker 关闭了 queue 没关闭呢？
    return Promise.all([
      this.worker?.close(),
      this.queueDelegate?.close()
    ]).then(() => this.state = Status.Closed);
  }
}

module.exports = {
  SongDownloadQueue: SongDownloadQueue,
  SongDownloadQueueStatus: Status,
}
