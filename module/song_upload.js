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
const cloud = async (query, request) => {
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
  ).then((res) => {
    if (res.status != 200 || res.body.code != 200) {
      console.log('res', res)
    }
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
      if (tokenRes.status != 200 || tokenRes.body.code != 200) {
        console.log('tokenRes', tokenRes)
      }
      let tasks = []
      if (res.body.needUpload) {
        tasks.push(
          query.songFile.promise().then((data) => {
            query.songFile.data = data
            query.songFile.name = `query.songName.${ext}`
            uploadPlugin(query, request).then((uploadRes) => {
              if (uploadRes.status != 200 || uploadRes.body.code != 200) {
                console.log('uploadRes', uploadRes)
              }
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
          if (infoRes.status != 200 || infoRes.body.code != 200) {
            console.log('infoRes', infoRes)
          }
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
          )
        }),
      )

      const taskResponses = await Promise.all(tasks)
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
    const barrier = 2
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
      // console.log('uploadSongs', uploadSongs.length)
      for (let i = 0; i < uploadSongs.length; i++) {
        let uploadSong = uploadSongs[i]
        if (taskMap.size >= barrier) {
          let tsStart = Date.now()
          await Promise.any(taskMap.values()).catch((e) => {
            logger.error(`云盘歌曲上传错误`, {
              e,
            })
          })
          console.log('Run task duration:', Date.now() - tsStart, 'ms')
        }
        if (!taskMap.has(uploadSong.songId)) {
          const uploadTask = cloud(
            {
              songFile: {
                promise: () => fs.promises.readFile(uploadSong.targetPath),
                fileName: uploadSong.targetPath,
                songName: uploadSong.songName,
                md5: uploadSong.targetChecksum,
                size: uploadSong.targetFileSize,
                album: uploadSong.albumName,
                artist: uploadSong.artistsName,
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
            })
            .finally(() => taskMap.delete(uploadSong.songId))
          taskMap.set(uploadSong.songId, uploadTask)
        }
      }

      if (taskMap.size > 0) {
        await Promise.all(taskMap.values())
          .catch((e) => {
            logger.error(`云盘歌曲上传错误`, {
              e,
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
