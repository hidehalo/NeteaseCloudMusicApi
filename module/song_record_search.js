// TODO: 搜索本地的歌曲及云盘歌曲记录
import { SearchPattern, SongRepository } from '../lib/song'

module.exports = async (query, request, app) => {
  let repo = new SongRepository()
  let searchPattern = query.search || ''
  repo.addConstraints(
    new SearchPattern('songName', searchPattern),
    new SearchPattern('albumName', searchPattern),
    new SearchPattern('artistsName', searchPattern),
  )
  let result = await repo.first()
  // TODO: 还需要寻找云盘中的音乐
  return {
    status: 200,
    body: {
      result,
    },
    message: 'ok',
  }
}
