import { SongRecord, SongRepository } from "./storage";
import { getStateDescription, SongDownloadTaskStatus } from "./download_task";

class DownloadFilter {

  private static repo: SongRepository;
  private songsId: string[];
  private prepared: boolean;
  private filter: Map<string, boolean>;
  private newSongs: SongRecord[];

  constructor(songsId: string[]) {
    if (!DownloadFilter.repo) {
      DownloadFilter.repo = new SongRepository();
    }
    this.songsId = songsId;
    this.prepared = false;
    this.filter = new Map<string, boolean>();
    this.newSongs = [];
  }

  async prepare() {
    if (this.hasPrepared()) {
      return;
    }
    let [notExistsSongsId, allowDownloadSongsId] = await Promise.all([
      DownloadFilter.repo.notExists(this.songsId),
      DownloadFilter.repo.allowDownload(this.songsId)
    ]);
    let needDownloadSongsId = [...notExistsSongsId, ...allowDownloadSongsId];
    for (let i = 0; i < needDownloadSongsId.length; i++) {
      this.filter.set(needDownloadSongsId[i], true);
    }

    let newSongRecords = [];
    for (let i = 0; i < notExistsSongsId.length; i++) {
      newSongRecords.push({
        songId: notExistsSongsId[i],
        state: getStateDescription(SongDownloadTaskStatus.Waiting),
        stateDesc: getStateDescription(SongDownloadTaskStatus.Waiting),
      } as SongRecord);
    }

    let allDbThreads = [];
    this.prepared = true;
    // FIXME: 新歌缺少歌曲详细信息
    if (newSongRecords.length > 0) {
      allDbThreads.push(DownloadFilter.repo.bulkInsert(newSongRecords));
      this.newSongs = newSongRecords;
    }
    if (allowDownloadSongsId.length > 0) {
      allDbThreads.push(
        DownloadFilter.repo.batchUpdate(allowDownloadSongsId, {
          state: getStateDescription(SongDownloadTaskStatus.Waiting),
          stateDesc: getStateDescription(SongDownloadTaskStatus.Waiting),
        } as SongRecord)
      );
    }
    if (allDbThreads.length > 0) {
      await Promise.all(allDbThreads);
    }
  }

  hasPrepared(): boolean {
    return this.prepared;
  }

  shouldSkip(songId: string): boolean {
    return !this.filter.get(songId);
  }

  getNewSongs(): SongRecord[] {
    return this.newSongs;
  }
}

export {
  DownloadFilter
}
