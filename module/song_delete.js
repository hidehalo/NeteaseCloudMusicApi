// 删除歌曲记录及对应的本地文件
import { SongRepository, SongDownloadTaskStatus, StateIn } from '../lib/song'
const fs = require('fs')

module.exports = async (query, request, app) => {
  const repo = new SongRepository()
  repo.addConstraints(
    new StateIn([
      SongDownloadTaskStatus.Downloaded,
      SongDownloadTaskStatus.Skipped,
    ]),
  )
  let affected = 0
  return repo
    .findBySongId(query.id)
    .then((record) => {
      if (!record) {
        return null
      }
      fs.unlinkSync(record.targetPath)
      return record
    })
    .then(async (record) => {
      if (!record) {
        return null
      }
      if (!fs.existsSync(record.targetPath)) {
        affected = await repo.batchDelete([record.songId.toString()])
      }
      return {
        status: 200,
        body: {
          affected,
        },
        cookie: query.cookie,
      }
    })
}
