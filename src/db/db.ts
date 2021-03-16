import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import * as Postgres from 'pg';
import format from 'pg-format';
import { ManifestData, ConfigData } from './DataTypes';

const createTableIfNotExists = `
CREATE TABLE IF NOT EXISTS 
events (
	id varchar(20) PRIMARY KEY, 
	manifest JSONB,
	config JSONB
);
`

export interface DBClass {

	ready: Promise<void>;
	update(dataTypeName: string, data: ManifestData | ConfigData): Promise<Postgres.QueryResult<any[]>>;
	get(dataTypeName: string): Promise<Postgres.QueryResult<any[]>>;
	
}

/*
	Database class ideas borrowed from https://github.com/stevenvergenz/rp-badges/blob/master/src/db/db.ts
	By Steven Vergenz https://github.com/stevenvergenz
*/
export class DB implements DBClass {

	get ready() { return this._ready; }
	private _pool: Postgres.Pool;
	private _ready: Promise<void>;

	constructor(private _eventId: string, private _sessionId: string) {

		this._pool = new Postgres.Pool();
		this._ready = this.init();

	}

	public async update(dataTypeName: string, data: ManifestData | ConfigData): Promise<Postgres.QueryResult<any[]>> {

		const sql = format(`UPDATE events SET %I=$1 WHERE id=%L`, dataTypeName, this._eventId.toString());

		await this.ready;
		return this._pool.query(sql, [data]);

	}

	public async get(dataTypeName: string): Promise<Postgres.QueryResult<any[]>> {

		const sql = format(`SELECT %I FROM events WHERE id=%L`, dataTypeName, this._eventId.toString());

		await this.ready;
		return this._pool.query(sql);

	}

	private async init() {

		await this._pool.query(createTableIfNotExists);
		await this._pool.query(format(`INSERT INTO events(id) VALUES(%L) ON CONFLICT(id) DO NOTHING`, this._eventId.toString()));

	}

}