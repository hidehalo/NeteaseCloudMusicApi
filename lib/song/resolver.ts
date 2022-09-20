import getSongsDetail from '../../module/song_detail';
import { StaticIpRequest, BasicQuery } from '../http'

type Duration = number

interface Album {
  id: number|string
  name: string
  picUrl: string
}

interface Artisan {
  id: number|string
  name: string
}

interface Song {
  name: string
  id: number|string
  ar: Artisan[]
  al: Album
  dt: Duration
}

class ResolvedSong {
  query: SongQuery
  artisans: Artisan[]
  album: Album
  song: Song

  constructor(query: SongQuery, song: Song) {
    this.query = query;
    this.artisans = song.ar;
    this.album = song.al;
    this.song = song;
  }
}

interface BatchSongQuery extends BasicQuery {
  ids: string[]
}

interface SongQuery extends BasicQuery {
  id: string
}

class SongResolver {

  async resolveBatch(query: BatchSongQuery): Promise<ResolvedSong[]> {
    let request = new StaticIpRequest(query.ip);
    let songsResp = await getSongsDetail(query, request.send.bind(request));
    let resolvedSongs = [] as ResolvedSong[];
    for (let i = 0; i < songsResp.body.songs.length; i++) {
      let song = songsResp.body.songs[i] as Song;
      let SongQuery = {
        ip: query.ip,
        id: song.id,
        cookie: query.cookie,
      } as SongQuery;
      let resolvedSong = new ResolvedSong(SongQuery, song);
      resolvedSongs.push(resolvedSong);
    }
    return resolvedSongs;
  }
}

export {
  Song,
  Album,
  Artisan,
  ResolvedSong,
  SongResolver,
  SongQuery,
  BatchSongQuery,
}
