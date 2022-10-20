import { ResolvedSong, Song, SongQuery } from "./resolver";
import songsPaginator from '../../module/playlist_track_all';
import { StaticIpRequest, BasicQuery } from '../http';
import { ServerContext } from "../context";
import { SongRecord, SongRepository } from "./storage";
import { getStateDescription, SongDownloadTaskStatus } from "./download_task";

type ResolvedTrack = ResolvedSong[];

interface TrackQuery extends BasicQuery {
  id: string
}

interface ChunkQuery extends TrackQuery {
  offset: number
  limit: number
}

class Chunk {

  query: ChunkQuery;
  request: StaticIpRequest;
  resolved: boolean;
  resolvedData: ResolvedTrack;
  private static repo: SongRepository;

  constructor(query: ChunkQuery, request: StaticIpRequest) {
    this.query = query;
    this.request = request;
    this.resolved = false;
    this.resolvedData = [];
    if (!Chunk.repo) {
      Chunk.repo = new SongRepository();
    }
  }

  next(): Chunk {
    let newQuery = { ...this.query };
    newQuery.offset = this.query.offset + this.query.limit;
    return new Chunk(newQuery, this.request);
  }

  async resolve(): Promise<ResolvedTrack> {
    if (this.resolved) {
      return this.resolvedData;
    }

    let songsResp = await songsPaginator(this.query, this.request.send.bind(this.request));
    let songs = songsResp.body?.songs;
    if (!songs || !songs.length) {
      this.resolved = true;
      return this.resolvedData;
    }
    let songsId = songs.flatMap((song: Song) => song.id.toString());
    let [notExistsSongsId, allowDownloadSongsId] = await Promise.all([
      Chunk.repo.notExists(songsId),
      Chunk.repo.allowDownload(songsId)
    ]);
    // TODO: batch insert. don't upsert
    for (let i = 0; i < notExistsSongsId.length; i++) {
      let newSongRecord = {
        songId: notExistsSongsId[i],
        state: getStateDescription(SongDownloadTaskStatus.Waiting),
        stateDesc: getStateDescription(SongDownloadTaskStatus.Waiting),
      } as SongRecord;
      await Chunk.repo.upsert(newSongRecord);
    }
    for (let i = 0; i < allowDownloadSongsId.length; i++) {
      let updateSongRecord = {
        songId: allowDownloadSongsId[i],
        state: getStateDescription(SongDownloadTaskStatus.Waiting),
        stateDesc: getStateDescription(SongDownloadTaskStatus.Waiting),
      } as SongRecord;
      await Chunk.repo.upsert(updateSongRecord);
    }
    let needDownloadSongsId = [...notExistsSongsId, ...allowDownloadSongsId];
    let filter = new Map<string, boolean>();
    for (let i = 0; i < needDownloadSongsId.length; i++) {
      filter.set(needDownloadSongsId[i], true);
    }
    let skip = 0;
    for (let i = 0; i < songs.length; i++) {
      let song = songs[i] as Song;
      let songId = song.id.toString();
      if (!filter.get(songId)) {
        skip++;
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
    console.log('跳过了', skip);
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
      let songsResp = await songsPaginator(newQuery, request.send.bind(request));
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
    chunkQuery.limit = 100;
    return new Chunk(chunkQuery, request);
  }
}

export {
  TrackQuery,
  TrackResolver,
}
