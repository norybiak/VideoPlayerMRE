import Database from './database';

interface ManifestData {

	sessionId?: string,
	currentPlaylist?: number,
	currentVideo?: number,
    playlists?: Playlist[]
    
}

interface Playlist {

	name: string,
    trackList: string[]
    
}

export default class Manifest {

 	public get currentVideo() { return this._getCurrentVideo(); };
	public get currentPlaylist() { return this._getCurrentPlaylist(); };
	public ready: Promise<void>;
   
    public get data() { return this._data; };

	private _data: ManifestData = {
		currentPlaylist: 0, 
		currentVideo: 0,
		playlists: [
			{ name: "My Playlist", trackList: [] }
		] 
    };

	private _db: Database;
	
	constructor(eventId: string, sessionId: string) {

		this._db = new Database(eventId, sessionId);
		
		this.ready = new Promise(async (resolve, reject) => {
			await this._getOrCreate();
			resolve(undefined);
		});

	}
	
	public updateCurrentVideo(url: string) {

		this._getCurrentPlaylist().trackList[this._data.currentVideo] = url;

		this._save();

	}

	private _getCurrentVideo() {

		return this._getCurrentPlaylist().trackList[this._data.currentVideo];

	}

	private _getCurrentPlaylist() {

		return this._data.playlists[this._data.currentPlaylist];

	}

    private async _getOrCreate() {

		if (await this._db.checkFileExists(`${this._db.sessionId}_manifest.json`)) {
			let data = await this._db.readFile(`${this._db.sessionId}_manifest.json`);
			this._data = JSON.parse(data);
			this._verify();
		} else {
			this._data.sessionId = this._db.sessionId;
			this._db.createDirectory(this._db.sessionId);
			this._save();
		}

	}

	private _verify() {

		this._data.playlists = this._data.playlists.filter(list => (list !== null && 
			list !== undefined &&
			list.name !== undefined &&
			list.trackList !== undefined));

		this._data.playlists.forEach((list) => {
			list.trackList = list.trackList.filter(track => (track !== null && 
				track !== undefined &&
				track !== ""));
        });
        
	}

	private _save() {

        this._verify();
        this._db.createOrUpdateFile(`${this._db.sessionId}_manifest.json`, JSON.stringify(this._data, null, '\t'));
        
	}

}