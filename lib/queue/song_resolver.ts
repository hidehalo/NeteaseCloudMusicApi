import getSongDownloadUrl from '../../module/song_download_url'
import getSongsDetail from '../../module/song_detail'

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
class SongResolver
{
  requestWrapper: Function;

  constructor(requestWrapper: Function) {
    this.requestWrapper = requestWrapper
  }

  batchResolve(ids: number[])
  {
    getSongsDetail({ids:ids}, this.requestWrapper)
  }
}

