// 下载歌单到本地
module.exports = async (query, request, app) => {
  const dq = app.get('downloadQueue')
  const hasQueue = dq != undefined && dq != null
  const context = app.get('context')
  let downloadQuery = { ...query }
  let resp = {
    status: 200,
    body: {
      hasQueue,
    },
    cookie: query.cookie,
  }
  if (!downloadQuery.id) {
    resp.status = 400
  } else {
    await dq.producer.downloadTrack(downloadQuery)
  }
  return Promise.resolve(resp)
}
