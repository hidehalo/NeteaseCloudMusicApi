const playlistTrackAll = require('./playlist_track_all')
const song = require('../lib/song')

module.exports = (query, request) => {
  return playlistTrackAll(query, request)
    .then(async (res) => {
      let repo = new song.NeteaseSongRepository()
      res.body.songs = await repo.loadSongRecord(res.body.songs)
      return res
    })
    .catch((e) => console.error(e))
}
