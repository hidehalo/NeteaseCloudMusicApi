import { knex as createKnex, Knex } from 'knex';
import process from 'process';
import KnexConfig from '../../database/knexfile';
import { SongDownloadTaskStatus, getStateDescription } from './download_task';

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
  downloadProgress?: number,
}

abstract class Repository<RecordMapping extends {}, Result> {

  protected constraints: Constraint[] = [];

  createQueryBuilder(): Knex.QueryBuilder {
    let qb = this.getStore().table(this.getTable());
    for (let i = 0; i < this.constraints.length; i++) {
      this.constraints[i].apply(qb);
    }
    return qb;
  }

  createCommand() {
    return this.getStore().table(this.getTable());
  }

  abstract getStore(): Knex<RecordMapping, Result>;

  abstract getTable(): string;

  createStore(): Knex<RecordMapping, Result> {
    let appEnv = process.env.APP_ENV ? process.env.APP_ENV : 'development';
    return createKnex<RecordMapping, Result>(KnexConfig[appEnv]);
  }

  addConstraints(...constraints: Constraint[]) {
    for (let i = 0; i < constraints.length; i++) {
      this.constraints.push(constraints[i]);
    }
  }
}

class SongRepository extends Repository<SongRecord, any> {

  private static store: Knex<SongRecord, any>;

  constructor() {
    super();
    if (!SongRepository.store) {
      SongRepository.store = this.createStore();
    }
  }

  getStore(): Knex<SongRecord, any> {
    return SongRepository.store;
  }

  getTable(): string {
    return 'songs';
  }

  async findBySongId(songId: string, fields: string[] = ['*']): Promise<SongRecord> {
    return await this.createQueryBuilder().where('songId', songId).first(fields)
      .catch(e => { throw e });
  }

  async findMany(songsId: string[], fields: string[] = ['*']): Promise<SongRecord[]> {
    return await this.createQueryBuilder().where('songId', 'in', songsId).column(fields).select()
      .catch(e => { throw e });
  }

  async upsert(record: SongRecord): Promise<number[]> {
    return await this.createCommand().insert(record).onConflict('songId').merge();
  }

  async paginate(offset: number, limit: number, fields: string[] = ['*'], options = { cDt: undefined }) {
    let query = this.createQueryBuilder();
    if (options.cDt) {
      let isoDt = new Date(options.cDt).toISOString();
      query.where('createdAt', '>', isoDt);
    }
    return await query.offset(offset).limit(limit).column(fields).select();
  }
}

interface Constraint {
  apply(query: Knex.QueryBuilder): void;
}

class StateIn implements Constraint {

  private status;

  constructor(status: SongDownloadTaskStatus[]) {
    this.status = status;
  }

  apply(query: Knex.QueryBuilder): void {
    let statusDesc = this.status.map(state => getStateDescription(state));
    if (this.status.length == 1) {
      query.where('state', statusDesc[0]);
    } else {
      query.whereIn('state', statusDesc);
    }
  }
}

export {
  SongRecord,
  SongRepository,
  StateIn
}
