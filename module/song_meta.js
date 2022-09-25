const dl = require('./song_url_v1')
const mm = require('music-metadata')
const http = require('http')
const MP3Tag = require('mp3tag.js')
const fs = require('fs')
const NodeID3 = require('node-id3')
import FileMD5Checksum from 'md5-file'

module.exports = async (query, request, app) => {
  query.level = 'hires'
  const resp = await dl(query, request)
  const filepath =
    '/Users/TianChen/Music/NeteaseMusic/张亚飞/她的时光/爱一个人好难.flac'
  const beforeChecksum = FileMD5Checksum.sync(filepath)
  const meta = await mm.parseFile(filepath)
  console.log(JSON.stringify(meta))
  // const tags = {
  //   title: "爱一个人好难",
  //   artist: "张亚飞",
  //   album: "她的时光",
  //   TRCK: "27"
  // };
  // const success = NodeID3.update(tags, filepath);
  const verbose = false // Logs all processes using `console.log`
  // flac 主要是写 vorbis
  // 这条技术路线可能要放弃...
  let buffer = fs.readFileSync(filepath)
  const mp3tag = new MP3Tag(buffer, verbose)
  mp3tag.tags.title = '爱一个人好难'
  mp3tag.tags.artist = '张亚飞'
  mp3tag.tags.album = '她的时光'
  mp3tag.tags.track = '1'
  mp3tag.save()
  const afterChecksum = FileMD5Checksum.sync(filepath)
  app.get('context').logger.info('test music metadata', {
    beforeChecksum,
    afterChecksum,
  })
  http.get(resp.body.data[0].url, (dlResp) => {
    // let chunks = [];
    // dlResp.on('data', (chunk) => {
    //   chunks.push(chunk);
    // });
    dlResp.on('end', async () => {
      // const meta = await mm.parseStream(dlResp);
    })
  })

  return resp
}
