// 歌曲下载进度
import { SongRepository } from '../lib/song'

module.exports = (query, request) => {
  let ids = query.ids.split(',')
  let repo = new SongRepository()
  return repo
    .findMany(ids, ['songId', 'downloadProgress', 'state'])
    .then((records) => {
      // ORM
      if (!records.length) {
        return Array(ids.length).fill(undefined)
      }

      let mapById = new Map()
      let withoutPk = false
      for (let i = 0; i < records.length; i++) {
        if (records[i].hasOwnProperty('songId')) {
          mapById.set(records[i].songId, records[i])
        } else {
          withoutPk = true
          break
        }
      }

      if (withoutPk) {
        return records
      }

      let newRecords = []
      for (let i = 0; i < ids.length; i++) {
        newRecords.push(mapById.get(ids[i]))
      }
      return newRecords
    })
    .then((records) => {
      let progress = []
      for (let i = 0; i < records.length; i++) {
        let record = records[i]
        if (!record) {
          progress.push(0)
        } else if (record.state == '下载完成') {
          progress.push(100)
        } else {
          progress.push(record.downloadProgress || 0)
        }
      }
      let res = {
        status: 200,
        body: {
          code: 200,
          data: progress,
          message: 'ok',
        },
        cookie: [],
      }
      return res
    })
}
