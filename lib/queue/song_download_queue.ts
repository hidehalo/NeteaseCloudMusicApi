import * as BullMQ from 'bullmq';
import { DownloaderHelper, ErrorStats } from 'node-downloader-helper';

export interface SongDownloadParams {
  songId: string
  downloadUrl: string
}

enum Status {
  Build = 0,
  Inited,
  Started,
  Stoped,
}

class SongDownloadQueue {
  /**
   * @param {string}
   */
  queueName: string;

  state: Status;

  queueDelegate?: BullMQ.Queue;

  worker?: BullMQ.Worker;

  /**
   * @param {string} queueName - 队列名称
   */
  constructor(queueName: string) {
    this.queueName = queueName;
    this.state = Status.Build;
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
    this.state = Status.Inited;
  }

  async download(params: SongDownloadParams) {
    await this.queueDelegate?.add(`download song ${params.songId}`, params, {
      // jobId: this.getJobId(params.songId)
    });
  }

  getJobId(songId: string): string {
    return `${this.queueName}.download.${songId}`;
  }

  async handle(job: BullMQ.Job) {
    const cookieStr = Object.keys(job.data.cookie)
    .map(
      (key) =>
        encodeURIComponent(key) +
        '=' +
        encodeURIComponent(job.data.cookie[key]),
    )
    .join('; ');
    console.log(cookieStr);
    const dl = new DownloaderHelper(
      job.data.downloadUrl, 
      '/Users/TianChen/Music/网易云音乐',
      {
        headers: {
          Cookie: cookieStr
        },
        method: 'GET',      
      });
    const errorHandler = function (err: ErrorStats) {
      job.failedReason = err.message
    }
    dl.on('end', function (stat) {
      console.log("end", stat);
      job.updateProgress(100);
    });
    dl.on('error', errorHandler);
    dl.start().catch(function (reason) {
      console.log("catch error", reason);
      job.failedReason = reason;
    });
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
    console.log("queue is bootstraping...");
    if (this.state != Status.Inited) {
      return;
    }

    if (!this.worker) {
      this.worker = new BullMQ.Worker(this.queueName, this.handle, { 
        autorun: false,
        concurrency: 4,
        connection: {
          host: '127.0.0.1',
          port: 6379
        }
      });
      this.worker.on('completed', this.onCompleted);
      this.worker.on('failed', this.onFailed);
      this.worker.on('progress', this.onProgress);
    }
    if (this.worker.isPaused()) {
      this.worker.resume();
    } else {
      console.log("try to run");
      this.worker.run().then((ret) => {console.log(ret)});
    }
    this.state = Status.Started;
    console.log("queue was bootstraped");
  }

  async stop() {
    if (this.state != Status.Started) {
      return;
    }
    await this.worker?.pause();
    this.state = Status.Inited;
  }
}

module.exports = {
  SongDownloadQueue: SongDownloadQueue,
  SongDownloadQueueStatus: Status,
}
