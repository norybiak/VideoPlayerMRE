import Data from './data';
import { DBClass } from '../db';

export interface ConfigData {

	sessionId?: string,
	videoPlayerConfig?: VideoPlayerConfig,
    
}

interface VideoPlayerConfig {

    spread?: number,
	volume?: number,
	rolloffDistance?: number,
	loop?: boolean
    
}

export class Config extends Data {

	public get data() { return this._data; };
	
	public get spread() { return this._data.videoPlayerConfig.spread };
	public set spread(update) { this._data.videoPlayerConfig.spread = update };
	public get volume() { return this._data.videoPlayerConfig.volume };
	public set volume(update) { this._data.videoPlayerConfig.volume = update };
	public get rolloffDistance() { return this._data.videoPlayerConfig.rolloffDistance };
	public set rolloffDistance(update) { this._data.videoPlayerConfig.rolloffDistance = update };
	public get loop() { return this._data.videoPlayerConfig.loop };
	public set loop(update) { this._data.videoPlayerConfig.loop = update };

	protected _data: ConfigData = {
		videoPlayerConfig: {
			spread: 1,
			volume: 20,
			rolloffDistance: 10,
			loop: false
		}
	};
	
	constructor(db: DBClass) {

		super('config', db);
		
	}

	protected _verify() {

	}

}