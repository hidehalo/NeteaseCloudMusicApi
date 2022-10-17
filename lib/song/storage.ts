import { knex as createKnex, Knex } from 'knex';
import process from 'process';
import KnexConfig from '../../database/knexfile';

interface SongRecord {
  songId: string,
  songName: string,
  coverUrl: string,
  trackNumber: number,
  albumName: string,
  artistsName: string,
  sourceUrl: string,
  sourceChecksum: string,
  sourceFileSize: number,
  targetPath: string,
  targetChecksum: string,
  targetFileSize: number,
  state: string,
  stateDesc: string,
  createdAt?: string,
  downloadProgress?:number,
}

class SongRepository {
  private static store: Knex<SongRecord>

  constructor() {
    let appEnv = process.env.APP_ENV ? process.env.APP_ENV : 'development';
    if (!SongRepository.store) {
      SongRepository.store = createKnex<SongRecord>(KnexConfig[appEnv]);
    }
  }

  private createQueryBuilder(): Knex.QueryBuilder {
    return SongRepository.store.table('songs');
  }

  private createCommand() {
    return SongRepository.store.table('songs');
  }

  async findBySongId(songId: string, fields: string[] = ['*']): Promise<SongRecord> {
    return await this.createQueryBuilder().where('songId', songId).first(fields).catch(e => { throw e });
  }

  async findMany(songsId: string[], fields: string[] = ['*']): Promise<SongRecord[]> {
    return await this.createQueryBuilder().where('songId', 'in', songsId).column(fields).select()
      .then(records => {
        // ORM
        if (!records.length) {
          return Array(songsId.length).fill(undefined);
        }

        let mapById = new Map<string, SongRecord>();
        let withoutPk = false;
        for (let i = 0; i < records.length; i++) {
          if (records[i].hasOwnProperty('songId')) {
            mapById.set(records[i].songId, records[i]);
          } else {
            withoutPk = true;
            break;
          }
        }

        if (withoutPk) {
          return records;
        }

        let newRecords = [];
        for (let i = 0; i < songsId.length; i++) {
          newRecords.push(mapById.get(songsId[i]));
        }
        return newRecords;
      })
      .catch(e => { throw e });
  }

  // TODO: paginate & get

  async upsert(record: SongRecord): Promise<number[]> {
    return await this.createCommand().insert(record).onConflict('songId').merge();
  }
}

export {
  SongRecord,
  SongRepository
}
