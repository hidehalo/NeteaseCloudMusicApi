import { Song } from "./resolver";
import { SongRecord, SongRepository } from "./storage";

interface NeteaseSong extends Song {
    songRecord: SongRecord|null|undefined,
}

class NeteaseSongRepository {
    private songRepo: SongRepository;

    constructor() {
        this.songRepo = new SongRepository();
    }

    async loadSongRecord(songs: Song[]): Promise<NeteaseSong[]> {
        let songsId = [];
        for (let i = 0; i < songs.length; i++) {
            songsId.push(songs[i].id.toString());
        }
        let mapById = new Map<string, SongRecord>();
        let songRecords = await this.songRepo.findMany(songsId);
        for (let i = 0; i < songRecords.length; i++) {
          if (songRecords[i]) {
            mapById.set(songRecords[i].songId, songRecords[i]);
          }
        }
        let ret = [] as NeteaseSong[];
        for (let i = 0; i < songs.length; i++) {
          let tmp = { ...songs[i] } as NeteaseSong;
          tmp.songRecord = mapById.get(tmp.id.toString());
          ret.push(tmp);
        }
        return ret;
    }
}

export {
  NeteaseSongRepository
}
