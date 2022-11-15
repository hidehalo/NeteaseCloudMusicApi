// 上传音乐到网易云盘
import path from 'path'
import {
  SongRepository,
  SongDownloadTaskStatus,
  StateIn,
  UploadedEqual,
} from '../lib/song'
const cloudMatch = require('./cloud_match')
const fs = require('fs')
const uploadPlugin = require('../plugins/songUpload')
const hasUpload = require('../module/user_cloud_detail')
const cloud = async (query, request, logger) => {
  if (!query.songFile) {
    return Promise.reject({
      status: 500,
      body: {
        msg: '请上传音乐文件',
        code: 500,
      },
    })
  }

  let ext = path.extname(query.songFile.fileName)
  const filename = query.songFile.songName
    .replace(/\s/g, '')
    .replace(/\./g, '_')
  query.cookie.os = 'pc'
  query.cookie.appver = '2.9.7'
  const bitrate = 999000

  return request(
    'POST',
    `https://interface.music.163.com/api/cloud/upload/check`,
    {
      bitrate: String(bitrate),
      ext: '',
      length: query.songFile.size,
      md5: query.songFile.md5,
      songId: '0',
      version: 1,
    },
    {
      crypto: 'weapi',
      cookie: query.cookie,
      proxy: query.proxy,
      realIP: query.realIP,
    },
  )
    .then((res) => {
      logger.debug(`歌曲『${query.songFile.songName}』上传预检测通过`)
      return request(
        'POST',
        `https://music.163.com/weapi/nos/token/alloc`,
        {
          bucket: '',
          ext: ext,
          filename: filename,
          local: false,
          nos_product: 3,
          type: 'audio',
          md5: query.songFile.md5,
        },
        { crypto: 'weapi', cookie: query.cookie, proxy: query.proxy },
      ).then(async (tokenRes) => {
        logger.debug(`歌曲『${query.songFile.songName}』文件对象令牌申请通过`)
        let tasks = []
        if (res.body.needUpload) {
          tasks.push(
            query.songFile.promise().then(async (data) => {
              query.songFile.data = data
              query.songFile.name = `query.songName.${ext}`
              await uploadPlugin(query, request).then((uploadRes) => {
                logger.debug(
                  `歌曲『${query.songFile.songName}』本地文件上传通过`,
                )
                return uploadRes
              })
            }),
          )
        }

        tasks.push(
          request(
            'POST',
            `https://music.163.com/api/upload/cloud/info/v2`,
            {
              md5: query.songFile.md5,
              songid: res.body.songId,
              filename: filename,
              song: filename,
              album: query.songFile.album || '未知专辑',
              artist: query.songFile.artist || '未知艺术家',
              bitrate: String(bitrate),
              resourceId: tokenRes.body.result.resourceId,
            },
            {
              crypto: 'weapi',
              cookie: query.cookie,
              proxy: query.proxy,
              realIP: query.realIP,
            },
          ).then((infoRes) => {
            logger.debug(`歌曲『${query.songFile.songName}』基础信息更新通过`)
            return request(
              'POST',
              `https://interface.music.163.com/api/cloud/pub/v2`,
              {
                songid: infoRes.body.songId,
              },
              {
                crypto: 'weapi',
                cookie: query.cookie,
                proxy: query.proxy,
                realIP: query.realIP,
              },
            ).then((pubRes) => {
              logger.debug(`歌曲『${query.songFile.songName}』公开信息读取通过`)
              return pubRes
            })
          }),
        )

        const taskResponses = await Promise.all(tasks).catch((e) => {
          logger.error(`云盘歌曲『${query.songFile.songName}』上传错误`, {
            e,
            action: 'cloud',
          })
          return [e]
        })
        let body = { ...res.body }
        for (const taskResponse of taskResponses) {
          if (taskResponse) {
            body = { ...body, ...taskResponse.body }
          }
        }

        return {
          status: 200,
          body,
          cookie: res.cookie,
        }
      })
    })
    .catch((e) => {
      logger.error(`云盘歌曲『${query.songFile.songName}』上传错误`, {
        e,
        action: 'cloud',
      })
      return e
    })
}

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
      'targetChecksum',
      'targetFileSize',
      'albumName',
      'artistsName',
    ]
    let uploadSongs = []
    let offset = 0
    const limit = 1000
    let runOnce = true
    const barrier = 4
    let taskMap = new Map([])
    repo.addConstraints(
      new StateIn([
        SongDownloadTaskStatus.Downloaded,
        SongDownloadTaskStatus.Skipped,
      ]),
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
      for (let i = 0; i < uploadSongs.length; i++) {
        let uploadSong = uploadSongs[i]
        if (taskMap.size >= barrier) {
          // let tsStart = Date.now()
          await Promise.any(taskMap.values()).catch((e) => {
            logger.error(`云盘歌曲上传错误`, {
              e,
              action: 'main',
            })
          })
        }
        if (!taskMap.has(uploadSong.songId)) {
          let tsStart = null
          let uploadSongCopy = { ...uploadSong }
          const uploadTask = new Promise((resolve) => {
            tsStart = Date.now()
            resolve(true)
          }).then(() =>
            hasUpload(
              {
                id: uploadSongCopy.songId,
                cookie: query.cookie,
              },
              request,
            )
              .then(async (hasUploadRes) => {
                if (
                  hasUploadRes.body.data &&
                  hasUploadRes.body.data.length > 0
                ) {
                  uploadSongCopy.uploaded = true
                  await repo.upsert(uploadSongCopy)
                  logger.info(
                    `云盘歌曲『${uploadSongCopy.songName}』已存在，上传成功`,
                  )
                  return true
                }

                return cloud(
                  {
                    songFile: {
                      promise: () =>
                        fs.promises.readFile(uploadSongCopy.targetPath),
                      fileName: uploadSongCopy.targetPath,
                      songName: uploadSongCopy.songName,
                      md5: uploadSongCopy.targetChecksum,
                      size: uploadSongCopy.targetFileSize,
                      album: uploadSongCopy.albumName,
                      artist: uploadSongCopy.artistsName,
                    },
                    cookie: query.cookie,
                  },
                  request,
                  logger,
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
                          asid: uploadSongCopy.songId,
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
                      uploadSongCopy.uploaded = true
                      await repo.upsert(uploadSongCopy)
                      logger.info(
                        `云盘歌曲『${uploadSongCopy.songName}』上传成功`,
                      )
                      return true
                    } else {
                      logger.error(
                        `云盘歌曲『${uploadSongCopy.songName}』上传失败：${
                          res.body.message || res.body.msg
                        }`,
                        { res },
                      )
                      return false
                    }
                  })
                  .catch((e) => {
                    logger.error(
                      `云盘歌曲『${uploadSongCopy.songName}』上传错误`,
                      {
                        e,
                      },
                    )
                  })
              })
              .finally(() => {
                taskMap.delete(uploadSongCopy.songId)
                logger.debug(
                  `歌曲『${uploadSongCopy.songName}』上传耗时：${
                    Date.now() - tsStart
                  } ms`,
                )
              }),
          )
          taskMap.set(uploadSong.songId, uploadTask)
        }
      }

      if (taskMap.size > 0) {
        await Promise.all(taskMap.values())
          .catch((e) => {
            logger.error(`云盘歌曲上传错误`, {
              e,
              action: 'cloud',
            })
          })
          .finally(() => taskMap.clear())
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
