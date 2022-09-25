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

class SongDownloader {

  async download(context: ServerContext, rootPath: string, resolvedSong: ResolvedSong) {
    const request = new StaticIpRequest(context, resolvedSong.query.ip);
    const http = {
      method: 'GET',
      cookie: resolvedSong.query.cookie
    } as HttpEntity
    let downloadResp = await getDownloadUrl(resolvedSong.query, request.send.bind(request));
    http.url = downloadResp.body.data.url;
    let checksum = downloadResp.body.data.md5;
    let totalSize = downloadResp.body.data.size;

    if (!http.url) {
      let newQuery = { ...resolvedSong.query } as any;
      newQuery.level = 'hires';
      // 有时 `getDownloadUrl` 无法成功获取，如果不同的 API 都无法得到下载地址
      // 那大概率是音乐资源被下架了... :)
      downloadResp = await getDownloadUrlNew(newQuery, request.send.bind(request));
      http.url = downloadResp.body.data[0]?.url;
      checksum = downloadResp.body.data[0]?.md5;
      totalSize = downloadResp.body.data[0]?.size;
    }

    const task = new SongDownloadTask(context, {
      http: http,
      rootPath: rootPath,
      resolvedSong: resolvedSong,
      checksum,
      totalSize
    })

    if (!http.url) {
      let errMsg = `歌曲『${resolvedSong.song.name}』无法解析下载地址`;
      context.logger.error(errMsg, {
        songId: resolvedSong.song.id,
        resp: downloadResp
      });
      task.state = SongDownloadTaskStatus.Error;
      task.err = new Error(errMsg);
      return task;
    }

    if (!checksum) {
      console.log(downloadResp.body.data);
    }

    await task.run(DownloadTaskRunMode.Resume);
    return task;
  }
}

export {
  SongDownloader,
}
