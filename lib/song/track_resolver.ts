import { ResolvedSong, Song, SongQuery } from "./resolver";
import songsPaginator from '../../module/playlist_track_all';
import { StaticIpRequest, BasicQuery } from '../http';
import { ServerContext } from "../context";
import { DownloadFilter } from "./download_filter";
import getTrackDetail from '../../module/playlist_detail';


type ResolvedTrack = ResolvedSong[];

interface TrackQuery extends BasicQuery {
  id: string
}

interface ChunkQuery extends TrackQuery {
  offset: number
  limit: number
}

function requestWrapper(request: StaticIpRequest) {
  return request.send.bind(request);
}

class Chunk {

  query: ChunkQuery;
  request: StaticIpRequest;
  resolved: boolean;
  resolvedData: ResolvedTrack;
  filter?: DownloadFilter;

  constructor(query: ChunkQuery, request: StaticIpRequest) {
    this.query = query;
    this.request = request;
    this.resolved = false;
    this.resolvedData = [];
  }

  next(): Chunk {
    let newQuery = { ...this.query };
    newQuery.offset = this.query.offset + this.query.limit;
    return new Chunk(newQuery, this.request);
  }
  
  offset(): number {
    return this.query.offset;
  }

  requestWrapper() {
    return requestWrapper(this.request);
  }

  async resolve(): Promise<ResolvedTrack> {
    if (this.resolved) {
      return this.resolvedData;
    }

    let songsResp = await songsPaginator(this.query, this.requestWrapper());
    let songs = songsResp.body?.songs;
    if (!songs || !songs.length) {
      this.resolved = true;
      return this.resolvedData;
    }
    let songsId = songs.flatMap((song: Song) => song.id.toString());
    let downloadFilter = new DownloadFilter(songsId);
    await downloadFilter.prepare();
    this.filter = downloadFilter;

    for (let i = 0; i < songs.length; i++) {
      let song = songs[i] as Song;
      let songId = song.id.toString();
      if (downloadFilter.shouldSkip(songId)) {
        continue;
      }
      let songQuery = {
        id: songId,
        ip: this.query.ip,
        cookie: this.query.cookie,
        proxy: this.query?.proxy,
        realIp: this.query?.realIp,
      } as SongQuery;
      let resolvedSong = new ResolvedSong(songQuery, song);
      this.resolvedData.push(resolvedSong);
    }
    this.resolved = true;
    return this.resolvedData;
  }
}

class TrackResolver {
  context: ServerContext;

  constructor(context: ServerContext) {
    this.context = context;
  }

  async resolve(query: TrackQuery): Promise<ResolvedTrack> {
    const request = new StaticIpRequest(this.context, query.ip);
    let page = 1;
    const length = 100;
    let songs = [];
    let lastSong = null;
    let ret = [] as ResolvedTrack;

    while (true) {
      let offset = (page - 1) * length;
      let newQuery = { ...query } as any;
      newQuery.offset = offset;
      newQuery.limit = length;
      let songsResp = await songsPaginator(newQuery, requestWrapper(request));
      songs = songsResp.body?.songs;

      if (!songs || !songs.length) {
        break;
      }

      if (songs[songs.length - 1].id == lastSong?.song?.id) {
        break
      }

      for (let i = 0; i < songs.length; i++) {
        let song = songs[i] as Song;
        let songQuery = {
          id: song.id.toString(),
          ip: query.ip,
          cookie: query.cookie,
          proxy: query?.proxy,
          realIp: query?.realIp,
        } as SongQuery;
        let resolvedSong = new ResolvedSong(songQuery, song);
        lastSong = resolvedSong;
        ret.push(resolvedSong);
      }

      page++;
    }

    return ret;
  }

  chunk(query: TrackQuery): Chunk {
    const request = new StaticIpRequest(this.context, query.ip);
    let chunkQuery = { ...query } as ChunkQuery;
    chunkQuery.offset = 0;
    chunkQuery.limit = 500;
    return new Chunk(chunkQuery, request);
  }

  async metadata(query: TrackQuery) {
    const request = new StaticIpRequest(this.context, query.ip);
    let trackDetail = await getTrackDetail(query, requestWrapper(request));
    return {
      totalCount: trackDetail.body.playlist.trackCount || 0
    };
  }
}

export {
  TrackQuery,
  TrackResolver,
}
