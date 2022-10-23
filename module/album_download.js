// 下载专辑中的所有歌曲
const getAlbum = require('./album')
module.exports = (query, request, app) => {
  return getAlbum(query, request)
    .then((res) => {
      let songs = res.body.songs || []
      let ids = []
      for (let i = 0; i < songs.length; i++) {
        ids.push(Number(songs[i].id).toString())
      }
      if (ids.length > 0) {
        let downloadQueue = app.get('downloadQueue')
        downloadQueue.producer.downloadSongs({
          ids: ids,
          ip: query.ip,
          cookie: query.cookie,
          proxy: query.proxy,
          realIp: query.realIp,
        })
      }

      return {
        status: 200,
        body: {},
        cookie: query.cookie,
      }
    })
    .catch((e) => {
      console.error(e)
    })
}
