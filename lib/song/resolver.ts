import getSongsDetail from '../../module/song_detail';
import { ServerContext } from '../context';
import { StaticIpRequest, BasicQuery } from '../http'

type Duration = number

interface Album {
  id: number
  name: string
  picUrl: string
}

interface Artisan {
  id: number
  name: string
}

interface Song {
  name: string
  id: number
  ar: Artisan[]
  al: Album
  dt: Duration
  no: number
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
  context: ServerContext

  constructor(context: ServerContext) {
    this.context = context;
  }

  async resolveBatch(query: BatchSongQuery): Promise<ResolvedSong[]> {
    let request = new StaticIpRequest(this.context, query.ip);
    let queryPolyfill = { ...query } as any;
    queryPolyfill.ids = query.ids.join(',');
    let songsResp = await getSongsDetail(queryPolyfill, request.send.bind(request));
    // FIXME: 有时候 `getSongsDetail` 无法查询到音乐信息，但是这个音乐却是可以下载的...
    // 这个有可能是由于云盘音乐数据缺失导致的
    // 建议对缺失的数据再做一次 /user/cloud/detail?id=... 的数据补充
    let resolvedSongs = [] as ResolvedSong[];
    for (let i = 0; i < songsResp.body.songs.length; i++) {
      let song = songsResp.body.songs[i] as Song;
      let SongQuery = {
        ip: query.ip,
        id: song.id.toString(),
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
