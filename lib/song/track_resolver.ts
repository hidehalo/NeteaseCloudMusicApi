import { ResolvedSong, Song, SongQuery } from "./resolver";
import songsPaginator from  '../../module/playlist_track_all';
import { StaticIpRequest, BasicQuery } from '../http';

type ResolvedTrack = ResolvedSong[];

interface TrackQuery extends BasicQuery {
  id: string
}

class TrackResolver {

  async resolve(query: TrackQuery): Promise<ResolvedTrack> {
    const request = new StaticIpRequest(query.ip);
    let page = 1;
    const length = 100;
    let songs = [];
    let lastSong = null;
    let ret = [] as ResolvedTrack;

    while (true) {
      let offset = (page-1) * length;
      let newQuery = {...query} as any;
      newQuery.offset = offset;
      newQuery.limit = length;
      // TODO: 不要等待所有数据读取完成再去进行下载
      let songsResp = await songsPaginator(newQuery, request.send.bind(request));
      songs = songsResp.body?.songs;
      
      if (!songs || !songs.length) {
        break;
      }

      if (songs[songs.length-1].id == lastSong?.song?.id) {
        break
      }

      for (let i = 0; i < songs.length; i++) {
        let song = songs[i] as Song;
        let songQuery = {
          id: song.id,
          ip: query.ip,
          cookie: query.cookie,
          proxy: query?.proxy,
          realIp: query?.realIp,
        } as SongQuery;
        let resolvedSong = new ResolvedSong(songQuery, song);
        lastSong = resolvedSong;
        ret.push(resolvedSong);
      }
      console.log(`read page ${page} ${songs?.length} records`)

      page++;
    }

    return ret;
  }
}

export {
  TrackQuery,
  TrackResolver,
}
