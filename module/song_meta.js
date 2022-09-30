const dl = require('./song_url_v1')
import { writeID3Tags } from '../lib/song'

module.exports = async (query, request, app) => {
  // query.level = 'hires'
  // const resp = await dl(query, request)
  writeID3Tags()

  return { code: 200, data: {}, msg: 'ok' }
}
