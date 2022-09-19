import getDownloadUrl from '../../module/song_download_url';

interface Album {}
interface Artisan {}
interface Song {}

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
  resolve(songId: string): ResolvedSong {
    return {} as ResolvedSong;
  }
}

class SongDownloader {
  download(resolvedSong: ResolvedSong): void {

  }
}
