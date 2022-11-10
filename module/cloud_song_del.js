// 云盘歌曲删除及歌曲记录上传标识失效
import { SongRepository } from '../lib/song'
const userCloudDel = require('./user_cloud_del')

module.exports = (query, request) => {
  return userCloudDel(query, request).then(async (res) => {
    const repo = new SongRepository()
    await repo.upsert({
      songId: query.id,
      uploaded: false,
    })
    return res
  })
}
