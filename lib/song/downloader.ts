import { ResolvedSong } from './resolver'
import getDownloadUrl from '../../module/song_download_url';
import getDownloadUrlNew from '../../module/song_url_v1';
import { StaticIpRequest } from '../http';
import { ServerContext } from '../context';
import {
  HttpEntity,
  SongDownloadTask,
  SongDownloadTaskStatus,
  DownloadTaskRunMode,
} from './download_task';
import { SongRepository, SongRecord } from './storage';
import fs from 'fs';
import { UnrecoverableError } from 'bullmq';

const dumpHttpEntity = {
  method: 'GET',
  url: '',
  cookie: {},
  checksum: '',
  totalSize: 0,
} as HttpEntity;

class SongDownloader {

  private songRepo: SongRepository;

  constructor() {
    this.songRepo = new SongRepository();
  }

  // FIXME: 有概率拿到只有 30 秒的试听音乐文件下载地址
  // 测试样本 装醉
  private async resolveDownloadHttp(context: ServerContext, resolvedSong: ResolvedSong): Promise<HttpEntity> {
    try {
      const request = new StaticIpRequest(context, resolvedSong.query.ip);
      let http = {
        method: 'GET',
        cookie: resolvedSong.query.cookie
      } as HttpEntity
      let downloadResp = await getDownloadUrl(resolvedSong.query, request.send.bind(request));
      http.url = downloadResp.body.data.url;
      http.checksum = downloadResp.body.data.md5;
      http.totalSize = downloadResp.body.data.size;
  
      if (!http.url) {
        let newQuery = { ...resolvedSong.query } as any;
        newQuery.level = 'hires';
        // 有时 `getDownloadUrl` 无法成功获取，如果不同的 API 都无法得到下载地址
        // 那大概率是音乐资源被下架了... :)
        downloadResp = await getDownloadUrlNew(newQuery, request.send.bind(request));
        http.url = downloadResp.body.data[0]?.url;
        http.checksum = downloadResp.body.data[0]?.md5;
        http.totalSize = downloadResp.body.data[0]?.size;
      }
      return http;
    } catch (e) {
      let err = e as Error;
      context.logger.error(`解析歌曲『${resolvedSong.song.name}』下载地址错误，原因 ${err.message}`, {err});
      return dumpHttpEntity;
    }
  }

  async download(context: ServerContext, rootPath: string, resolvedSong: ResolvedSong): Promise<SongDownloadTask> {
    const persistedSong = await this.songRepo.findBySongId(Number(resolvedSong.song.id).toFixed(0));
    try {
      if (persistedSong && 
        fs.existsSync(persistedSong?.targetPath) &&
        persistedSong.sourceChecksum == persistedSong.targetChecksum) {
          let dumpTask = new SongDownloadTask(context, {
            http: dumpHttpEntity,
            rootPath,
            resolvedSong
          });
          dumpTask.state = SongDownloadTaskStatus.Skipped;
          context.logger.debug(`快速跳过下载歌曲『${resolvedSong.song.name}』`);
          return dumpTask;
      }
    } catch (e) {
      let err = e as Error;
      context.logger.error(`文件系统不稳定，原因是：${err.message}`, {err});
      throw new UnrecoverableError(`文件系统不稳定，主动取消任务重试`);
    }
 
    const http = await this.resolveDownloadHttp(context, resolvedSong);
    const task = new SongDownloadTask(context, {
      http: http,
      rootPath: rootPath,
      resolvedSong: resolvedSong
    });

    let songRecord = {
      songId: Number(resolvedSong.song.id).toFixed(0),
      songName: resolvedSong.song.name,
      coverUrl: resolvedSong.album.picUrl,
      trackNumber: resolvedSong.song.no,
      albumName: resolvedSong.album.name,
      artistsName: resolvedSong.artisans.flatMap((artisan) => artisan.name).join(','),
      sourceUrl: http.url? http.url: '',
      sourceChecksum: http.checksum,
      sourceFileSize: http.totalSize,
    } as SongRecord;

    if (!http.url) {
      let errMsg = `歌曲『${resolvedSong.song.name}』无法解析下载地址`;
      context.logger.error(errMsg, {
        songId: resolvedSong.song.id
      });
      task.state = SongDownloadTaskStatus.Error;
      task.err = new Error(errMsg);
      songRecord.state = task.getStateDescription();
      songRecord.stateDesc = '无法解析下载地址';
      await this.songRepo.upsert(songRecord);
      throw new UnrecoverableError(`${errMsg}，主动取消任务重试`);
    }

    try {
      await task.run(DownloadTaskRunMode.Resume);
      songRecord.state = task.getStateDescription();
      if (task.hasFileExists()) {
        songRecord.targetPath = task.getTargetPath();
        songRecord.targetChecksum = task.getTargetFileChecksum(true);
        songRecord.targetFileSize = task.getTargetFileSize();
      }
    } catch (e) {
      task.state = SongDownloadTaskStatus.Error;
      task.err = e as Error;
    }
    if (task.err) {
      songRecord.stateDesc = task.err.message;
    } else {
      songRecord.stateDesc = task.getStateDescription();
    }
    await this.songRepo.upsert(songRecord);
    return task;
  }
}

export {
  SongDownloader,
}
