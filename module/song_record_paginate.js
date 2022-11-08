// 查询歌曲在本地数据库中的记录

import { SongRepository, StateIn, SongDownloadTaskStatus } from '../lib/song'

module.exports = (query, request) => {
  let offset = query.offset || 0
  let limit = query.limit || 30
  let createdAt = query.createdAt || undefined
  let state = query.state || undefined
  let repo = new SongRepository()
  if (state == 'waiting') {
    repo.addConstraints(new StateIn([SongDownloadTaskStatus.Waiting]))
  } else if (state == 'downloading') {
    repo.addConstraints(new StateIn([SongDownloadTaskStatus.Downloading]))
  } else if (state == 'done') {
    repo.addConstraints(
      new StateIn([
        SongDownloadTaskStatus.Downloaded,
        SongDownloadTaskStatus.Skipped,
      ]),
    )
  } else if (state == 'error') {
    repo.addConstraints(
      new StateIn([
        SongDownloadTaskStatus.Error,
        SongDownloadTaskStatus.Cancel,
        SongDownloadTaskStatus.Timeout,
      ]),
    )
  }
  let fields = [
    'songId',
    'coverUrl',
    'state',
    'stateDesc',
    'artistsName',
    'songName',
    'albumName',
    'targetFileSize',
    'createdAt',
    'uploaded',
  ]

  return repo
    .paginate(offset, limit, fields, { cDt: createdAt })
    .then((records) => {
      for (let i = 0; i < records.length; i++) {
        if (records[i].state == '下载完成' || records[i].state == '跳过下载') {
          records[i].downloadProgress = 100
        }
        if (records[i].downloadProgress === null) {
          records[i].downloadProgress = 0
        }
      }
      let res = {
        status: 200,
        body: {
          code: 200,
          data: records,
          message: 'ok',
        },
        cookie: [],
      }
      return res
    })
}
