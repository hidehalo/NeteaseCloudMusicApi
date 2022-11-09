// 上传音乐到网易云盘
const cloud = require('./cloud')
const cloudMatch = require('./cloud_match')
const fs = require('fs')
import {
  SongRepository,
  SongDownloadTaskStatus,
  StateIn,
  UploadedEqual,
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
      'targetChecksum',
      'targetFileSize',
    ]
    let uploadSongs = []
    let offset = 0
    const limit = 1000
    let runOnce = true
    let tasks = []
    const barrier = 4
    repo.addConstraints(
      new StateIn([SongDownloadTaskStatus.Downloaded]),
      new UploadedEqual(false),
    )
    do {
      if (ids[0] === 'all') {
        runOnce = false
        uploadSongs = await repo.paginate(offset, limit, selectFields, {
          cDt: firstRecordCreatedAt,
        })
        if (uploadSongs.length > 0 && firstRecordCreatedAt === undefined) {
          firstRecordCreatedAt = uploadSongs[0].createdAt
        }
        offset += uploadSongs.length
      } else {
        uploadSongs = await repo.findMany(ids, selectFields)
      }
      console.log('uploadSongs', uploadSongs.length)
      tasks.length = 0

      for (let i = 0; i < uploadSongs.length; i++) {
        let uploadSong = uploadSongs[i]
        if (tasks.length >= barrier) {
          console.log('run tasks', tasks.length)
          await Promise.all(tasks)
            .catch((e) => {
              logger.error(`云盘歌曲上传错误`, {
                e,
              })
            })
            .finally(() => (tasks.length = 0))
        }
        tasks.push(
          fs.promises
            .readFile(uploadSong.targetPath)
            .then((buffer) =>
              cloud(
                {
                  songFile: {
                    name: uploadSong.songName,
                    data: buffer,
                    md5: uploadSong.targetChecksum,
                    size: uploadSong.targetFileSize,
                  },
                  cookie: query.cookie,
                },
                request,
              ),
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
              if (
                (res && res.status === 200 && res.body.code === 200) ||
                res.body.message == '纠错后的文件已在云盘存在'
              ) {
                uploadSong.uploaded = true
                await repo.upsert(uploadSong)
                logger.info(`云盘歌曲『${uploadSong.songName}』上传成功`)
                return true
              } else {
                logger.error(
                  `云盘歌曲『${uploadSong.songName}』上传失败：${
                    res.body.message || res.body.msg
                  }`,
                  { res },
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
        console.log('push new task', tasks.length)
      }

      if (tasks.length > 0) {
        await Promise.all(tasks)
          .catch((e) => {
            logger.error(`云盘歌曲上传错误`, {
              e,
            })
          })
          .finally(() => (tasks.length = 0))
      }

      if (runOnce) {
        uploadSongs.length = 0
      }
    } while (uploadSongs.length)
  }

  return {
    status: 200,
    body: {},
    cookie: query.cookie,
  }
}
