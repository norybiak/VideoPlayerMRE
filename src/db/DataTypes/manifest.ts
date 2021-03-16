import Data from './data';
import { DBClass } from '../db';

export interface ManifestData {

	sessionId?: string,
	currentPlaylistIndex?: number,
	currentVideoIndex?: number,
    playlists?: Playlist[]
    
}

export interface Playlist {

	name: string,
    trackList: Tracklist[]
    
}

export interface Tracklist {

	url: string,
    title: string
    
}

export class Manifest extends Data {

	public get data() { return this._data; };
	public get currentVideoIndex() { return this._data.currentVideoIndex; };
	public set currentVideoIndex(update) { this._data.currentVideoIndex = update; };
	public get currentPlaylistIndex() { return this._data.currentPlaylistIndex; };
	public set currentPlaylistIndex(update) { this._data.currentPlaylistIndex = update; };
	public get playlists() { return this._data.playlists };

	protected _data: ManifestData = {
		currentPlaylistIndex: 0, 
		currentVideoIndex: 0,
		playlists: [
			{ name: "My Playlist", trackList: [] }
		]
	}
	constructor(db: DBClass) {

		super('manifest', db);

	}

	public getCurrentVideo() {

		return this.getCurrentPlaylist().trackList[this._data.currentVideoIndex];

	}

	public updateCurrentVideo(url: string) {

		this.getCurrentPlaylist().trackList[this._data.currentVideoIndex].url = url;

		if (this._db) {
			this.save();
		}

	}

	public getCurrentPlaylist() {

		return this._data.playlists[this._data.currentPlaylistIndex];

	}

	public createPlaylist(name: string) {

		let playlist: Playlist = { name: name, trackList: [] };
		this._data.playlists.push(playlist);

		return playlist;
		
	}

	protected _verify() {

		this._data.playlists = this._data.playlists.filter(list => (list !== null && 
			list !== undefined &&
			list.name !== undefined &&
			list.trackList !== undefined));

		this._data.playlists.forEach((list) => {
			list.trackList = list.trackList.filter(track => (track !== null && 
				track !== undefined &&
				track.url !== undefined &&
				track.title !== undefined));
        });
        
	}

}