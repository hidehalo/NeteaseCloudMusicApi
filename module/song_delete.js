// TODO: impl
// 删除歌曲记录及对应的本地文件
import {
  SongRepository,
  SongDownloadTaskStatus,
  getStateDescription,
} from '../lib/song'
const fs = require('fs')

module.exports = async (query, request, app) => {
  return {
    status: 200,
    body: {
      message: '未实现呢！！！',
    },
    cookie: query.cookie,
  }
}
