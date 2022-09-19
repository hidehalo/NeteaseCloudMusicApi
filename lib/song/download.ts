import getDownloadUrl from '../../module/song_download_url';
import { DownloaderHelper, ErrorStats } from 'node-downloader-helper';

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
}
class ResolvedSong {
  artisan: Artisan;
  album: Album;
  song: Song;

  constructor(artisan: Artisan, album: Album, song: Song) {
    this.artisan = artisan;
    this.album = album;
    this.song = song;
  }

  getSong(): Song {
    return this.song;
  }

  getArtisan(): Artisan {
    return this.artisan;
  }

  getAlbum(): Album {
    return this.album;
  }
}

class SongResolver {
  batchResolve(songIds: string[]): ResolvedSong[] {
    return [];
  }
}

class SongDownloader {
  download(resolvedSong: ResolvedSong): void {
    const cookieStr = Object.keys(job.data.cookie)
    .map(
      (key) =>
        encodeURIComponent(key) +
        '=' +
        encodeURIComponent(job.data.cookie[key]),
    )
    .join('; ');
    console.log(cookieStr);
    const dl = new DownloaderHelper(
      job.data.downloadUrl, 
      '/Users/TianChen/Music/网易云音乐',
      {
        headers: {
          Cookie: cookieStr
        },
        method: 'GET',      
      });
    const errorHandler = function (err: ErrorStats) {
      job.failedReason = err.message
    }
    dl.on('end', function (stat) {
      console.log("end", stat);
      job.updateProgress(100);
    });
    dl.on('error', errorHandler);
    dl.start().catch(function (reason) {
      console.log("catch error", reason);
      job.failedReason = reason;
    });
  }
}
