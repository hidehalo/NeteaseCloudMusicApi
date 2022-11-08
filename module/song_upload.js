// 上传音乐到网易云盘
const cloud = require('./cloud')
const cloudMatch = require('./cloud_match')
const fs = require('fs')
import {
  SongRepository,
  SongDownloadTaskStatus,
  getStateDescription,
} from '../lib/song'

module.exports = async (query, request, app) => {
  let logger = app.get('logger')
  if (query.ids && query.uid) {
    let ids = query.ids.split(',')
    let repo = new SongRepository()
    let firstRecordCreatedAt = undefined
    const selectFields = [
      'songId',
      'songName',
      'targetPath',
      'state',
      'uploaded',
    ]
    let songs = []
    let offset = 0
    let limit = 1000
    let runOnce = true
    do {
      if (ids[0] === 'all') {
        runOnce = false
        songs = await repo.paginate(offset, limit, selectFields, {
          cDt: firstRecordCreatedAt,
        })
        if (songs.length > 0 && firstRecordCreatedAt === undefined) {
          firstRecordCreatedAt = songs[0].createdAt
        }
        offset += songs.length
      } else {
        songs = await repo.findMany(ids, selectFields)
      }
      let uploadSongs = []
      for (let song of songs) {
        if (
          song.state ==
            getStateDescription(SongDownloadTaskStatus.Downloaded) &&
          !song.uploaded
        ) {
          uploadSongs.push(song)
        }
      }
      const barrier = 4
      let tasks = []
      console.log('uploadSongs', uploadSongs.length)
      for (let i = 0; i < uploadSongs.length; i++) {
        let uploadSong = uploadSongs[i]
        if (tasks.length == barrier) {
          await Promise.all(tasks).catch((e) => {
            logger.error(`云盘歌曲上传错误`, {
              e,
            })
          })
          tasks.length = 0
        }
        tasks.push(
          cloud(
            {
              songFile: {
                name: uploadSong.songName,
                data: fs.readFileSync(uploadSong.targetPath),
              },
              cookie: query.cookie,
            },
            request,
          )
            .then((res) => {
              if (
                res.status === 200 &&
                (res.body.code === 200 || res.body.code === 201)
              ) {
                return cloudMatch(
                  {
                    uid: query.uid,
                    sid: res.body.privateCloud.simpleSong.id,
                    asid: uploadSong.songId,
                    realIp: query.realIp,
                    cookie: query.cookie,
                  },
                  request,
                )
              } else {
                return res
              }
            })
            .then(async (res) => {
              if (res && res.status === 200 && res.body.code === 200) {
                let updatedRecord = { ...uploadSong, uploaded: true }
                await repo.upsert(updatedRecord)
                logger.info(`云盘歌曲『${uploadSong.songName}』上传成功`)
                return true
              } else {
                logger.error(
                  `云盘歌曲『${uploadSong.songName}』上传失败：${
                    res.body.message || res.body.msg
                  }`,
                )
                return false
              }
            })
            .catch((e) => {
              logger.error(`云盘歌曲『${uploadSong.songName}』上传错误`, {
                e,
              })
            }),
        )
      }
      if (runOnce) {
        songs.length = 0
      }
    } while (songs.length)
  }

  return {
    status: 200,
    body: {},
    cookie: query.cookie,
  }
}
