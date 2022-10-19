// 查询歌曲在本地数据库中的记录

import { SongRepository } from '../lib/song'

module.exports = (query, request) => {
  let ids = query.ids.split(',')
  // let format = query.format || 'download'
  let repo = new SongRepository()
  let fields = ['songId', 'state', 'stateDesc', 'downloadProgress']

  return repo
    .findMany(ids, fields)
    .then((records) => {
      // ORM
      if (!records.length) {
        return Array(ids.length).fill(undefined)
      }

      let mapById = new Map()
      let withoutPk = false
      for (let i = 0; i < records.length; i++) {
        if (records[i].state == '下载完成' || records[i].state == '跳过下载') {
          records[i].downloadProgress = 100
        }
        if (records[i].downloadProgress === null) {
          records[i].downloadProgress = 0
        }
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
