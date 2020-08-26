import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import Server from './server';
import getVideoDuration from 'get-video-duration';
import URL from 'url';
import fetch from 'node-fetch';
// @ts-ignore
import twitchStreams from 'twitch-get-stream';

import * as MediaController from './media-controls';

const VIDEO_PLAYER_WIDTH = 1;
const VIDEO_PLAYER_HEIGHT = 1 / (16/9);
const BUTTON_SCALE = 0.02;

interface Admins {

	controls?: MRE.Actor,
	isVideoPlayerHovered: boolean,
	isControlsHovered: boolean,
	isVolumeHovered: boolean,
	isVolumeSliderHovered: boolean

}

/**
 * The main class of this app. All the logic goes here.
 */
export default class VideoPlayer {

	private assets: MRE.AssetContainer;
	private videos: MRE.AssetContainer;

	private admins: { [key: string]: Admins } = {};

	// VIDEO PLAYER
	private videoPlayerContainer: MediaController.Container;
	private adminVideoPlayerContainer: MediaController.Container;
	private videoStream: MRE.VideoStream;
	private videoInstance: MRE.MediaInstance;
	private videoDuration: number;
	private isVideoPlaying: boolean;

	// VIDEO CONFIG
	private loop: boolean = false;
	private volume: number = 0.5;
	private isLiveStream: boolean = false;
	private muted: boolean = false;

	// MODERATOR MEDIA CONTROLS
	private adminControlsContainer: MediaController.Container;
	private seekSliderPuck: MRE.Actor;
	private volumeSliderPuck: MRE.Actor;
	private timeLabel: MediaController.Label;
	private mediaDurationLabel: string;
	private holdingSliderPuck: boolean = false;

	// MODERATOR VIDEO PLAYER TEXT
	private adminInfoContainer: MediaController.Container;
	private adminInfoActive: MediaController.Label;

	//LOOP
	private tick = 10;
	private tickInterval = 1000 / this.tick;
	private expected = Date.now();

	// TIMES
	private currentTime: number;

	constructor(private context: MRE.Context, private params: MRE.ParameterSet) {

		this.videos = new MRE.AssetContainer(context);
		this.assets = new MRE.AssetContainer(context);

		this.context.onStarted(() => this.init());
		this.context.onUserJoined((user) => this.handleUser(user));

	}

	/**
	 * Once the context is "started", initialize the app.
	 */
	private async init() {

		this.createVideoPlayerContainer();
		this.createVideoPlayerInfoLabels()
		this.createAdminControls();
		this.startLoop();
	}

	private handleUser(user: MRE.User) {

		if (this.checkUserRole(user, 'moderator')) {
			user.groups.set(['admin']);

			this.admins[user.id.toString()] = {
				isControlsHovered: false,
				isVideoPlayerHovered: false,
				isVolumeHovered: false,
				isVolumeSliderHovered: false
			};
		} else {
			user.groups.set(['user']);
		}

	}

	private createVideoPlayerContainer() {

		this.videoPlayerContainer = new MediaController.Container(this.context, this.assets, Server.baseUrl, {
			actor: {
				name: 'videoPlayerContainer',
				appearance: {
					meshId: this.assets.createBoxMesh('box', VIDEO_PLAYER_WIDTH, VIDEO_PLAYER_HEIGHT, 0.0001).id,
					materialId: this.assets.createMaterial('material', { color: MRE.Color3.Black() }).id,
				}
			}
		});

		this.videoPlayerContainer.addBehavior('enter', (user) => {
			if (this.checkUserRole(user, 'moderator')) {
				let admin = this.admins[user.id.toString()];
				admin.isVideoPlayerHovered = true;
				user.groups.add('adminShowControls');
			}
		});

		this.videoPlayerContainer.addBehavior('exit', (user) => {
			if (this.checkUserRole(user, 'moderator')) {
				let admin = this.admins[user.id.toString()];
				admin.isVideoPlayerHovered = false;

				setTimeout(() => {
					if (!admin.isVideoPlayerHovered && !admin.isControlsHovered) {
						user.groups.delete('adminShowControls');
					}	
				}, 1000);
			}
		});

		this.videoPlayerContainer.addBehavior('click', (user) => {
			if (this.checkUserRole(user, 'moderator')) {
				user.prompt("Enter Video URL", true).then((dialog) => {
					if (dialog.submitted) {
						this.stop();
						this.parseUrl(dialog.text).then((url) => {
							if (url) {
								this.createOrUpdateVideoPlayer(url);
							}
						});
					}
				});
			}
		});

	}

	private createVideoPlayerInfoLabels() {

		this.adminInfoContainer = new MediaController.Container(this.context, this.assets, Server.baseUrl, {
			labelScale: 0.1,
			actor: {
				name: 'adminTextLayer',
				appearance: {
					enabled: new MRE.GroupMask(this.context, ['admin'])
				},
				transform: {
					local: {
						position: { x: 0, y: 0, z: -0.001 }
					}
				}
			}
		});

		this.adminInfoActive = this.adminInfoContainer.createLabel("Click to enter URL", {
			name: "ClickText", appearance: { enabled: true }
		});
		this.adminInfoContainer.createLabel("This video cannot \n be played due \n to copyright", { 
			name: "YoutubeCiphered", appearance: { enabled: false }
		});	
		this.adminInfoContainer.createLabel("This video is \n not viewable \n outside of \n Youtube.com", { 
			name: "YoutubeUnplayable", appearance: { enabled: false }
		});
		this.adminInfoContainer.createLabel("Invalid URL", { 
			name: "InvalidUrl", appearance: { enabled: false }
		});
		this.adminInfoContainer.createLabel("Attempting to load", { 
			name: "Load", appearance: { enabled: false }
		});
		this.adminInfoContainer.createLabel("Failed to get \n live stream!", { 
			name: "InvalidChannel", appearance: { enabled: false }
		});

	}

	private async createAdminControls() {

		this.adminControlsContainer = new MediaController.Container(this.context, this.assets, Server.baseUrl, {
			iconScale: BUTTON_SCALE,
			actor: {
				appearance: { enabled: new MRE.GroupMask(this.context, ['adminShowControls']) },
				transform: {
					local: {
						position: { x: 0, y: -(VIDEO_PLAYER_HEIGHT/2) + 1/20, z: -0.001 }
					}
				},
			}
		});

		this.timeLabel = this.adminControlsContainer.createLabel('', {
			transform: {
				local: {
					position: { x: 1.5/20, y: -0.5/20 }
				}
			},
			text: {
				height: 0.02
			}
		});

		await this.adminControlsContainer.loadGltf();

		this.adminControlsContainer.createIcon(MediaController.IconType.Play, {
			name: "playBtn",
			transform: { local: { position: { x: -9/20 } } }
		}).addBehavior('released', () => this.play())

		this.adminControlsContainer.createIcon(MediaController.IconType.Pause, {
			name: "pauseBtn",
			appearance: { enabled: false },
			transform: { local: { position: { x: -9/20 } } }
		}).addBehavior('released', () => this.pause());

		this.adminControlsContainer.createIcon(MediaController.IconType.Stop, {
			name: "stopBtn",
			transform: { local: { position: { x: -7.5/20 } } }
		}).addBehavior('released', () => this.stop());

		this.adminControlsContainer.createIcon(MediaController.IconType.Restart, {
			name: "restartBt",
			transform: { local: { position: { x: -6/20 } } }
		}).addBehavior('released', () => this.restart());

		this.adminControlsContainer.createIcon(MediaController.IconType.LoopOn, {
			name: "loopOnBtn",
			appearance: { enabled: false },
			transform: { local: { position: { x: 9/20 } } }
		}).addBehavior('released', () => this.toggleLoop());

		this.adminControlsContainer.createIcon(MediaController.IconType.LoopOff, {
			name: "loopOffBtn",
			transform: { local: { position: { x: 9/20 } } }
		}).addBehavior('released', () => this.toggleLoop());

		const seeksSlider = this.adminControlsContainer.createIcon(MediaController.IconType.Slider, {
			name: "seekSlider",
			transform: { local: { position: { x: 1/20 }, scale: { x: 1.65 * BUTTON_SCALE, y: BUTTON_SCALE, z: BUTTON_SCALE } } }
		});

		seeksSlider.addBehavior('holding', (user, data) => {
			this.holdingSliderPuck = true;

			if (this.isVideoPlaying && !this.isLiveStream) {
				data.targetedPoints.forEach((pointData) => {
					let pos = { transform: { local: { position: { x: pointData.localSpacePoint.x, y: 0, z: 0.1 } } } };
					this.seekSliderPuck.animateTo(pos, 0.01, MRE.AnimationEaseCurves.Linear);
				});
			}
		});

		seeksSlider.addBehavior('released', (user, data) => {
			this.holdingSliderPuck = false;

			if (this.isVideoPlaying && !this.isLiveStream) {
				let pointX = data.targetedPoints[0].localSpacePoint.x;

				let seekTime = (this.videoDuration / 1000) * this.normalize(-8, 8, pointX);

				this.currentTime = seekTime * 1000;

				this.videoInstance.setState({ time: seekTime });
			}
		});

		this.seekSliderPuck = this.adminControlsContainer.createIcon(MediaController.IconType.SliderPuck, {
			name: "seekSliderPuck",
			parentId: seeksSlider.actor.id,
			transform: {
				local: {
					position: { x: -8, y: 0, z: -0.1 },
					scale: { x: 0.65, y: 1, z: 1 },
					rotation: MRE.Quaternion.Zero()
				}
			}
		}).actor;

		const volumeSlider = this.adminControlsContainer.createIcon(MediaController.IconType.Slider, {
			name: "volumeSlider",
			appearance: { enabled: false },
			transform: {
				local: {
					position: { x: 7.5/20, y: 1.5/20 },
					scale: { x: 0.25 * BUTTON_SCALE, y: BUTTON_SCALE, z: BUTTON_SCALE },
					rotation: MRE.Quaternion.FromEulerAngles(180 * MRE.DegreesToRadians, 90 * MRE.DegreesToRadians, -90 * MRE.DegreesToRadians),
				}
			}
		})
		
		volumeSlider.addBehavior('enter', (user) => {
			if (this.checkUserRole(user, 'moderator')) {
				let admin = this.admins[user.id.toString()];
				admin.isControlsHovered = true;
				admin.isVolumeSliderHovered = true;
			}
		})
		
		volumeSlider.addBehavior('exit', (user) => {
			if (this.checkUserRole(user, 'moderator')) {
				let admin = this.admins[user.id.toString()];
				admin.isControlsHovered = false;
				admin.isVolumeSliderHovered = false;
				
				setTimeout(() => {
					if (!admin.isVolumeHovered) {
						volumeSlider.hide();
						volumeSlider.disableCollider();
					}	
				}, 1500);
			}
		})

		volumeSlider.addBehavior('released', (user, data) => {

			let pointX = data.targetedPoints[0].localSpacePoint.x;

			let pos = { transform: { local: { position: { x: pointX } } } };
			this.volumeSliderPuck.animateTo(pos, 0.01, MRE.AnimationEaseCurves.Linear);

			this.volume = this.normalize(-8, 8, pointX);

			if (this.videoInstance && !this.muted) {
				this.videoInstance.setState({ volume: this.volume });	
			}
		});

		this.volumeSliderPuck = this.adminControlsContainer.createIcon(MediaController.IconType.SliderPuck, {
			name: "volumeSliderPuck",
			parentId: volumeSlider.actor.id,
			transform: {
				local: {
					position: { x: 0, y: -0.01, z: 0 },
					scale: { x: 2, y: 1, z: 1 },
					rotation: MRE.Quaternion.Zero()
				}
			}
		}).actor;

		const volumeBtn = this.adminControlsContainer.createIcon(MediaController.IconType.Volume, {
			name: "volumeBtn",
			transform: { local: { position: { x: 7.5/20 } } }
		});
		
		volumeBtn.addBehavior('enter', (user) => {
			if (this.checkUserRole(user, 'moderator')) {
				let admin = this.admins[user.id.toString()]
				admin.isControlsHovered = true;
				admin.isVolumeHovered = true;

				volumeSlider.show();
				volumeSlider.enableCollider();
			}
		});
		
		volumeBtn.addBehavior('exit', (user) => {
			if (this.checkUserRole(user, 'moderator')) {
				let admin = this.admins[user.id.toString()]
				admin.isControlsHovered = false;
				admin.isVolumeHovered = false;

				setTimeout(() => {
					if (!admin.isVolumeSliderHovered) {
						volumeSlider.hide();
						volumeSlider.disableCollider();
					}	
				}, 1500);
			}
		});
		
		volumeBtn.addBehavior('released', (user) => {
			this.mute(true);
			volumeBtn.hide();
			volumeBtn.disableCollider();
			muteBtn.show();
			muteBtn.enableCollider();
		});

		const muteBtn = this.adminControlsContainer.createIcon(MediaController.IconType.Mute, {
			name: "muteBtn",
			appearance: { enabled: false },
			transform: { local: { position: { x: 7.5/20 } } }
		});
		
		muteBtn.addBehavior('released', (user) => {
			this.mute(false);
			volumeBtn.show();
			volumeBtn.enableCollider();
			muteBtn.hide();
			muteBtn.disableCollider();
		});

		this.adminControlsContainer.icons.forEach(e => {
			if (e.name !== "volumeBtn" && e.name !== "volumeSlider") {
				e.addBehavior('enter', (user) => handleEnter(user, e)).addBehavior('exit', (user) => handleExit(user, e));
			}
		});

		const handleEnter = (user: MRE.User, e: MediaController.Icon) => {
			if (this.checkUserRole(user, 'moderator')) {
				let admin = this.admins[user.id.toString()]
				admin.isControlsHovered = true;
			}
		};

		const handleExit = (user: MRE.User, e: MediaController.Icon) => {
			if (this.checkUserRole(user, 'moderator')) {
				let admin = this.admins[user.id.toString()];
				admin.isControlsHovered = false;
			}
		}

	}

	private async parseUrl(input: string) {

		let parsedInputAsURL = URL.parse(input, true);
		let videoUrl = parsedInputAsURL.href;

		this.showLabel('Load');

		this.isLiveStream = false;

		if (parsedInputAsURL.protocol === null) {
			this.showLabel("InvalidUrl");
			return;
		}
		if (input.includes('tinyurl')) {
			videoUrl = await this.handleTinyUrl(parsedInputAsURL);
		}
		else if (input.includes('youtube')) {
			videoUrl = await this.handleYoutube(parsedInputAsURL);
		}
		else if (input.includes('dlive')) {
			videoUrl = await this.handleDLive(parsedInputAsURL);
		}
		else if (input.includes('twitch')) {
			videoUrl = await this.handleTwitch(parsedInputAsURL);
		}

		if (input.includes('m3u8')) {
			this.isLiveStream = true;
		}

		return videoUrl;

	}

	private async handleTinyUrl(theUrl: URL.UrlWithParsedQuery) {

		let tinyId = "";

		if (theUrl.protocol.includes("tinyurl")) {
			tinyId = theUrl.hostname;
		}
		else if (theUrl.protocol.includes("http") && theUrl.path) {
			tinyId = theUrl.pathname.substr(1);
		}
		else {
			this.showLabel("InvalidUrl");
			return;
		}

		let realUrl = await fetch(`https://tinyurl.com/${tinyId}`);

		//run through parseUrl with new URL
		return await this.parseUrl(realUrl.url);

	}

	private async handleYoutube(theUrl: URL.UrlWithParsedQuery) {

		let videoId = "";

		if (theUrl.protocol.includes("youtube")) {
			videoId = theUrl.hostname;
		}
		else if (theUrl.protocol.includes("http") && theUrl.query.v) {
			videoId = theUrl.query.v as string;
		} else {
			this.showLabel("InvalidUrl");
			return;
		}

		const response = await fetch(`https://www.youtube.com/get_video_info?video_id=${videoId}`);
		const info = await response.text();

		let videoInfo = JSON.parse(unescape(info).match(/(?<=player_response=)[^&]+/)[0]);

		if (videoInfo.playabilityStatus.status === "UNPLAYABLE") {
			this.showLabel("YoutubeUnplayable");
			return;
		}

		if (videoInfo.videoDetails.isLiveContent) {
			this.isLiveStream = true;

			if (videoInfo.streamingData.hlsManifestUrl) {
				return videoInfo.streamingData.hlsManifestUrl;
			}
		}

		if (
			videoInfo.streamingData.adaptiveFormats && (
				videoInfo.streamingData?.adaptiveFormats[0]?.cipher ||
				videoInfo.streamingData?.adaptiveFormats[0]?.signatureCipher
			) ||
			videoInfo.streamingData.formats && (
				videoInfo.streamingData?.formats[0]?.cipher ||
				videoInfo.streamingData?.formats[0]?.signatureCipher
			)
		)
		{
			this.showLabel("YoutubeCiphered");
			return;
		}

		return `youtube://${videoId}`;

	}

	private async handleDLive(theUrl: URL.UrlWithParsedQuery) {

		let channel = "";

		if (theUrl.protocol.includes("dlive")) {
			channel = theUrl.hostname;
		} else if (theUrl.protocol.includes("http") && theUrl.pathname !== "") {
			channel = theUrl.pathname.substr(1);
		} else {
			this.showLabel("InvalidUrl");
			return;
		}

		this.isLiveStream = true;

		let url = `https://live.prd.dlive.tv/hls/live/${channel.toLowerCase()}.m3u8`;

		let res = await fetch(url);

		if (res.ok) {
			return url;
		} else { 
			let username = await this.scrapeDLive(channel.toLowerCase());

			if (username === undefined) {
				this.showLabel("InvalidChannel");
				return;
			}

			channel = username;
		}

		return url;

	}

	private async handleTwitch(theUrl: URL.UrlWithParsedQuery) {

		let channel = "";
		let m3u8Url = "";
		let shortenedm3u8Url = "";

		if (theUrl.protocol.includes("twitch")) {
			channel = theUrl.hostname;
		} else if (theUrl.protocol.includes("http") && theUrl.pathname !== "") {
			channel = theUrl.pathname.substr(1);
		} else {
			this.showLabel("InvalidUrl");
			return;
		}

		await twitchStreams.get(channel).then((streams: any) => {
			m3u8Url = streams[0].url;
				// we could find a resolution that works best instead
				// for (var stream of streams)
				//    console.log(stream.quality + ' (' + stream.resolution + '): ' + stream.url);
		}).catch((error: string) => {
			if (error) {
				this.showLabel("InvalidChannel");
				return console.log('Error caught:', error);
			}
		});

	    // we need to shorten the url because there is a bug in Altspace's MRE and the URL can't be very long
		shortenedm3u8Url = await this.shortenUrl(m3u8Url);

		if (!shortenedm3u8Url) {
			this.showLabel("InvalidChannel");
			return;
		}

		shortenedm3u8Url + ".m3u8";
		this.isLiveStream = true;
		return shortenedm3u8Url;

	}

	private async createOrUpdateVideoPlayer(theUrl: string) {

		const options = {
			//looping: this.loop,
			rolloffStartDistance: 1,
			spread: 0.6,
			volume: this.volume,
			visible: true
		};

		this.setInitialPlayPauseButtonState();

		if (!this.videoStream || this.videoStream.uri !== theUrl) {	
			this.videoStream = this.videos.createVideoStream('videoStream', { uri: theUrl });
			
			await this.videoStream.created;
			this.videoDuration = this.videoStream.duration * 1000;

			if (theUrl.includes('webm') || theUrl.includes('mp4'))
				this.videoDuration = await getVideoDuration(theUrl) * 1000;
		}

		if (this.videoPlayerContainer.actor) {
			
			this.videoInstance = this.videoPlayerContainer.actor.startVideoStream(this.videoStream.id, options);
			this.videoPlayerContainer.hide()
		}

		if (this.isLiveStream) {
			this.mediaDurationLabel = "LIVE";
		} else {
			let minutes = '0' + Math.floor((this.videoDuration / (1000*60)) % 60);
			let seconds = '0' + Math.floor((this.videoDuration / 1000) % 60);
			this.mediaDurationLabel = `${ minutes.slice(-2) }:${ seconds.slice(-2) }`;
		}

		this.adminInfoActive.hide();
		this.isVideoPlaying = true; 
		this.currentTime = 0;
		this.changePlayPauseButtonState();

	}

	private play() { 

		if (this.videoInstance) {
			if (!this.isVideoPlaying) {
				this.isVideoPlaying = true;
			
				this.videoInstance.resume();
				this.changePlayPauseButtonState();
			}
		}

	}

	private stop() {

		if (this.videoInstance) {
			this.isVideoPlaying = false;
			this.isLiveStream = false;

			this.videoInstance.stop();
			this.videoInstance = null;
			this.videoPlayerContainer.show();
		
			this.showLabel("ClickText");
			this.setInitialPlayPauseButtonState();

			this.timeLabel.set(`00:00 / 00:00`);
		}

	}

	private pause() {

		if (this.videoInstance) {
			if (this.isVideoPlaying) {
				this.isVideoPlaying = false;

				this.videoInstance.pause();
				this.changePlayPauseButtonState();
			}
		}

	}

	private restart() {

		if (this.videoInstance) {
			this.videoInstance.setState({ time: 0 });
			this.currentTime = 0;
		}

	}

	private mute(bool: boolean) {

		this.muted = bool;

		if (this.videoInstance) {
			if (bool === true) {
				this.videoInstance.setState({ volume: 0 });
			} else {
				this.videoInstance.setState({ volume: this.volume });
			}
		}

	}

	private toggleLoop() {

		this.loop = !this.loop;

		let loopOnBtn = this.adminControlsContainer.getIcon('loopOnBtn');
		let loopOffBtn = this.adminControlsContainer.getIcon('loopOffBtn');

		loopOnBtn.toggleVisibility();
		loopOffBtn.toggleVisibility();

	}

	private setInitialPlayPauseButtonState() {

		let playBtn = this.adminControlsContainer.getIcon('playBtn');
		let pauseBtn = this.adminControlsContainer.getIcon('pauseBtn');

		playBtn.show();
		playBtn.enableCollider();

		pauseBtn.hide();
		pauseBtn.disableCollider();

	}

	private changePlayPauseButtonState() {

		let playBtn = this.adminControlsContainer.getIcon('playBtn');
		let pauseBtn = this.adminControlsContainer.getIcon('pauseBtn');

		playBtn.toggleVisibility();
		playBtn.toggleCollider();

		pauseBtn.toggleVisibility();
		pauseBtn.toggleCollider();

	}

	private showLabel(name: string) {

		this.adminInfoActive.hide();
		let label = this.adminInfoContainer.getLabel(name);
		label.show();
		this.adminInfoActive = label;

	}

	private checkUserRole(user: MRE.User, role: string) {

		if (user.properties['altspacevr-roles'] === role ||
		user.properties['altspacevr-roles'].includes(role)) {
			return true;
		}

		return false;

	}

	private startLoop() {

		let drift = Date.now() - this.expected;

		if (this.isVideoPlaying) {
			this.currentTime += this.tickInterval;

			let minutes = '0' + Math.floor((this.currentTime / (1000*60)) % 60);
			let seconds = '0' + Math.floor((this.currentTime / 1000) % 60);

			this.timeLabel.set(`${ minutes.slice(-2) }:${ seconds.slice(-2) } / ${this.mediaDurationLabel}`);

			let convertedRange = this.convertRange(0, this.videoDuration, -8, 8, this.currentTime);

			if (!this.holdingSliderPuck) {
				let pos = { transform: { local: { position: { x: convertedRange, y: 0, z: -0.1 } } } };
				this.seekSliderPuck.animateTo(pos, 0.01, MRE.AnimationEaseCurves.Linear);
			}
			
			if ((this.currentTime >= (this.videoDuration - 500)) && !this.isLiveStream) {
				if (this.loop) {
					this.restart();
				} else {
					this.stop();
				}	
			}
		}

		this.expected += this.tickInterval;
		setTimeout(() => { this.startLoop(); }, Math.max(0, this.tickInterval - drift));
		
	}

	private async shortenUrl (url: string) {

		let res = await fetch(`https://is.gd/create.php?format=simple&url=` + encodeURIComponent(url));

		if (!res.ok) {
			return undefined;
		}

		return await res.text();
	}

	private async scrapeDLive(channel: string) {

		let res = await fetch(`https://dlive.tv/${channel}`);

		if (!res.ok) {
			return undefined;
		}

		let text = await res.text();

		//Regex from https://github.com/streamlink/streamlink
		let username = text.match(/(?<=user:)(\w|-)+/);

		if (username !== null && username !== undefined) {
			return username[0];
		}
		else {
			return undefined;
		}

	}

	private normalize(min: number, max: number, input: number) {

		return (input - min) / (max - min);

	}

	private convertRange(x: number, y: number, a: number, b: number,input: number) {

		return ((input - x) / (y - x)) * (b - a) + a;

	}
}
