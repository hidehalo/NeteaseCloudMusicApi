import { SongRepository } from "./storage";

class DownloadFilter {

  private static repo: SongRepository;
  private songsId: string[];
  private prepared: boolean;
  private filter: Map<string, boolean>;
  private newSongs: string[];
  private updateSongs: string[];

  constructor(songsId: string[]) {
    if (!DownloadFilter.repo) {
      DownloadFilter.repo = new SongRepository();
    }
    this.songsId = songsId;
    this.prepared = false;
    this.filter = new Map<string, boolean>();
    this.newSongs = [];
    this.updateSongs = [];
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
    this.newSongs = notExistsSongsId;
    this.updateSongs = allowDownloadSongsId;
    for (let i = 0; i < needDownloadSongsId.length; i++) {
      this.filter.set(needDownloadSongsId[i], true);
    }
    this.prepared = true;
  }

  hasPrepared(): boolean {
    return this.prepared;
  }

  shouldSkip(songId: string): boolean {
    return !this.filter.get(songId);
  }

  getNewSongsId(): string[] {
    return this.newSongs;
  }

  getUpdateSongsId(): string[] {
    return this.updateSongs;
  }
}

export {
  DownloadFilter
}
