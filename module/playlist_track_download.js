// 下载歌曲到本地
const getSongDownloadUrl = require('./song_download_url')
const getSongsDetail = require('./song_detail')

module.exports = async (query, request, app) => {
  const dq = app.get('downloadQueue')
  const hasQueue = dq != undefined && dq != null
  // todo : 查询歌曲下载地址
  query.id = '29794921'
  let res = await getSongDownloadUrl(query, request)
  console.log(res)
  // todo : 查询歌曲详细名称
  // todo: batch downloads
  query.ids = '29794921'
  res = await getSongsDetail(query, request)
  console.log(res)
  await dq.download({
    songId: '29794921',
    downloadUrl:
      'http://m8.music.126.net/20220916013030/982cd8fc4dc6398bedc7426fb317aaef/ymusic/bc0f/cdcf/5282/9220113d83498d5c0b1d10ef5a0cdc21.flac',
    cookie: query.cookie,
  })
  const resp = {
    status: 200,
    body: {
      hasQueue,
    },
    cookie: query.cookie,
  }
  return Promise.resolve(resp)
}
