// 下载歌曲到本地
module.exports = (query, request, app) => {
  const dq = app.get('downloadQueue')
  let resp = {
    status: 200,
    body: {},
    cookie: query.cookie,
  }
  let downloadQuery = { ...query }
  if (!downloadQuery.id) {
    resp.status = 400
  } else {
    dq.producer.downloadSong(downloadQuery)
  }
  return Promise.resolve(resp)
}
