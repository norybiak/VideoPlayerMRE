import { DBClass } from '../db';

export default abstract class Data {

		public get data() { return this._data; };
		public get ready() { return this._ready; };

		protected _data: {};
		protected _ready: Promise<void>;

		protected constructor(protected _dataTypeName: string, protected _db: DBClass) {
			
			this._ready = this.init();

		}

		public async save() {

			this._verify();
			this._db.update(this._dataTypeName, this._data);
				
		}

		private async init() {

			const result = (await this._db.get(this._dataTypeName)).rows[0] as {[key: string]: any};

			if (result[this._dataTypeName] === null) {
				this.save();	
			} else {
				this._data = result[this._dataTypeName];
			}

		}

		protected abstract _verify(): void;

}