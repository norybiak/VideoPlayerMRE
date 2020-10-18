import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import server from './server';
import getVideoDuration from 'get-video-duration';
import URL from 'url';
import fetch from 'node-fetch';
import * as TwitchStreams from 'twitch-get-stream';
import * as MREUI from './UI';

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

	private UI: MREUI.UI;

	private admins: { [key: string]: Admins } = {};

	// VIDEO PLAYER
	private UIvideoPlayerGroup: MREUI.Group;
	private UIadminVideoPlayerGroup: MREUI.Group;
	private videoStream: MRE.VideoStream;
	private videoInstance: MRE.MediaInstance;
	private videoDuration: number;
	private isVideoPlaying: boolean;

	// VIDEO CONFIG
	private loop: boolean = false;
	private volume: number = 0.5;
	private isLiveStream: boolean = false;
	private muted: boolean = false;

	// MODERATOR UI MEDIA CONTROLS
	private UIadminControlsGroup: MREUI.Group;
	private seekSliderPuck: MRE.Actor;
	private volumeSliderPuck: MRE.Actor;
	private UItimeLabel: MREUI.Label;
	private mediaDurationLabel: string;
	private holdingSliderPuck: boolean = false;

	// MODERATOR UI VIDEO PLAYER TEXT
	private UIadminInfoGroup: MREUI.Group;
	private UIactiveInfo: MREUI.Label;

	//LOOP
	private tick = 10;
	private tickInterval = 1000 / this.tick;
	private expected = Date.now();

	// TIMES
	private currentTime: number;

	constructor(private context: MRE.Context, private params: MRE.ParameterSet) {

		this.videos = new MRE.AssetContainer(context);
		this.assets = new MRE.AssetContainer(context);

		this.UI = new MREUI.UI(this.context, {
			scale: BUTTON_SCALE
		});

		this.context.onStarted(() => this.init());
		this.context.onUserJoined((user) => this.handleUser(user));

	}

	/**
	 * Once the context is "started", initialize the app.
	 */
	private init() {

		this.createUI();
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

	private async createUI() {

		await this.UI.loadIconPack(`${server.baseUrl}/iconPacks/media`);
	
		this.createVideoPlayer();
		this.createVideoPlayerInfoLabels()
		this.createAdminControls();

	}

	private createVideoPlayer() {

		this.UIvideoPlayerGroup = this.UI.createGroup('UIvideoPlayerGroup', {
			actor: {
				appearance: {
					meshId: this.assets.createBoxMesh('box', VIDEO_PLAYER_WIDTH, VIDEO_PLAYER_HEIGHT, 0.0001).id,
					materialId: this.assets.createMaterial('material', { color: MRE.Color3.Black() }).id,
				}
			}
		});

		this.UIvideoPlayerGroup.addBehavior('enter', (user) => {
			if (this.checkUserRole(user, 'moderator')) {
				let admin = this.admins[user.id.toString()];
				admin.isVideoPlayerHovered = true;
				user.groups.add('adminShowControls');
			}
		});

		this.UIvideoPlayerGroup.addBehavior('exit', (user) => {
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

		this.UIvideoPlayerGroup.addBehavior('click', (user) => {
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

		this.UIadminInfoGroup = this.UI.createGroup('adminTextLayer', {
			groupScale: 0.1,
			mask: new MRE.GroupMask(this.context, ['admin']),
			position: { x: 0, y: 0, z: -0.001 }
		});

		this.UIactiveInfo = this.UIadminInfoGroup.createLabel("Click to enter URL", {
			name: "ClickText"
		});
		this.UIadminInfoGroup.createLabel("This video cannot \n be played due \n to copyright", { 
			name: "YoutubeCiphered", enabled: false
		});	
		this.UIadminInfoGroup.createLabel("This video is \n not viewable \n outside of \n Youtube.com", { 
			name: "YoutubeUnplayable", enabled: false
		});
		this.UIadminInfoGroup.createLabel("Invalid URL", { 
			name: "InvalidUrl", enabled: false
		});
		this.UIadminInfoGroup.createLabel("Attempting to load", { 
			name: "Load", enabled: false
		});
		this.UIadminInfoGroup.createLabel("Failed to get \n live stream!", { 
			name: "InvalidChannel", enabled: false
		});

	}

	private async createAdminControls() {

		this.UIadminControlsGroup = this.UI.createGroup('UIadminControlsGroup', {
			mask: new MRE.GroupMask(this.context, ['adminShowControls']),
			position: { x: 0, y: -(VIDEO_PLAYER_HEIGHT/2) + 1/20, z: -0.001 }
		});

		this.UItimeLabel = this.UIadminControlsGroup.createLabel('', {
			position: { x: 1.5/20, y: -0.5/20 },
			height: 0.02
		});

		this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.Play, {
			name: "playBtn",
			position: { x: -9/20 }
		}).addBehavior('released', () => this.play())

		this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.Pause, {
			name: "pauseBtn",
			enabled: false,
			position: { x: -9/20 }
		}).addBehavior('released', () => this.pause());

		this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.Stop, {
			name: "stopBtn",
			position: { x: -7.5/20 }
		}).addBehavior('released', () => this.stop());

		this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.Restart, {
			name: "restartBt",
			position: { x: -6/20 }
		}).addBehavior('released', () => this.restart());

		this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.LoopOn, {
			name: "loopOnBtn",
			enabled: false,
			position: { x: 9/20 }
		}).addBehavior('released', () => this.toggleLoop());

		this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.LoopOff, {
			name: "loopOffBtn",
			position: { x: 9/20 }
		}).addBehavior('released', () => this.toggleLoop());

		const seeksSlider = this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.Slider, {
			name: "seekSlider",
			position: { x: 1/20 }, scale: { x: 1.65 * BUTTON_SCALE, y: BUTTON_SCALE, z: BUTTON_SCALE }
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

		this.seekSliderPuck = this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.SliderPuck, {
			name: "seekSliderPuck",
			parentId: seeksSlider.actor.id,
			position: { x: -8, y: 0, z: -0.1 },
			scale: { x: 0.65, y: 1, z: 1 },
			rotation: MRE.Quaternion.Zero()
		}).actor;

		const volumeSlider = this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.Slider, {
			name: "volumeSlider",
			enabled: false,
			position: { x: 7.5/20, y: 1.5/20 },
			scale: { x: 0.25 * BUTTON_SCALE, y: BUTTON_SCALE, z: BUTTON_SCALE },
			rotation: MRE.Quaternion.FromEulerAngles(180 * MRE.DegreesToRadians, 90 * MRE.DegreesToRadians, -90 * MRE.DegreesToRadians),
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

		this.volumeSliderPuck = this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.SliderPuck, {
			name: "volumeSliderPuck",
			parentId: volumeSlider.actor.id,
			position: { x: 0, y: -0.01, z: 0 },
			scale: { x: 2, y: 1, z: 1 },
			rotation: MRE.Quaternion.Zero()
		}).actor;

		const volumeBtn = this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.Volume, {
			name: "volumeBtn",
			position: { x: 7.5/20 }
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

		const muteBtn = this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.Mute, {
			name: "muteBtn",
			enabled: false,
			position: { x: 7.5/20 }
		});
		
		muteBtn.addBehavior('released', (user) => {
			this.mute(false);
			volumeBtn.show();
			volumeBtn.enableCollider();
			muteBtn.hide();
			muteBtn.disableCollider();
		});

		this.UIadminControlsGroup.icons.forEach(e => {
			if (e.name !== "volumeBtn" && e.name !== "volumeSlider") {
				e.addBehavior('enter', (user) => handleEnter(user, e)).addBehavior('exit', (user) => handleExit(user, e));
			}
		});

		const handleEnter = (user: MRE.User, e: MREUI.Icon) => {
			if (this.checkUserRole(user, 'moderator')) {
				let admin = this.admins[user.id.toString()]
				admin.isControlsHovered = true;
			}
		};

		const handleExit = (user: MRE.User, e: MREUI.Icon) => {
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

		if (!res.ok) {
			try {
				const username = await this.getDLiveUsername(channel.toLowerCase());
				url = `https://live.prd.dlive.tv/hls/live/${username.toLowerCase()}.m3u8`
			} catch (err) {
				this.showLabel(err);
				return
			}
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

		await TwitchStreams.get(channel).then((streams: any) => {
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

		if (this.UIvideoPlayerGroup.actor) {
			
			this.videoInstance = this.UIvideoPlayerGroup.actor.startVideoStream(this.videoStream.id, options);
			this.UIvideoPlayerGroup.hide()
		}

		if (this.isLiveStream) {
			this.mediaDurationLabel = "LIVE";
		} else {
			let minutes = '0' + Math.floor((this.videoDuration / (1000*60)) % 60);
			let seconds = '0' + Math.floor((this.videoDuration / 1000) % 60);
			this.mediaDurationLabel = `${ minutes.slice(-2) }:${ seconds.slice(-2) }`;
		}

		this.UIactiveInfo.hide();
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
			this.UIvideoPlayerGroup.show();
		
			this.showLabel("ClickText");
			this.setInitialPlayPauseButtonState();

			this.UItimeLabel.set(`00:00 / 00:00`);
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

		let loopOnBtn = this.UIadminControlsGroup.getIconByName('loopOnBtn');
		let loopOffBtn = this.UIadminControlsGroup.getIconByName('loopOffBtn');

		loopOnBtn.toggleVisibility();
		loopOffBtn.toggleVisibility();

	}

	private setInitialPlayPauseButtonState() {

		let playBtn = this.UIadminControlsGroup.getIconByName('playBtn');
		let pauseBtn = this.UIadminControlsGroup.getIconByName('pauseBtn');

		playBtn.show();
		playBtn.enableCollider();

		pauseBtn.hide();
		pauseBtn.disableCollider();

	}

	private changePlayPauseButtonState() {

		let playBtn = this.UIadminControlsGroup.getIconByName('playBtn');
		let pauseBtn = this.UIadminControlsGroup.getIconByName('pauseBtn');

		playBtn.toggleVisibility();
		playBtn.toggleCollider();

		pauseBtn.toggleVisibility();
		pauseBtn.toggleCollider();

	}

	private showLabel(name: string) {

		this.UIactiveInfo.hide();
		let label = this.UIadminInfoGroup.getLabelByName(name);
		label.show();
		this.UIactiveInfo = label;

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

			this.UItimeLabel.set(`${ minutes.slice(-2) }:${ seconds.slice(-2) } / ${this.mediaDurationLabel}`);

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

	private async getDLiveUsername(displayName: string): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const query = `query{
				userByDisplayName(displayname:"${displayName}") {
					username
					displayname
				}
			}`

			fetch('https://graphigo.prd.dlive.tv/', {
				method: 'POST',
				body: JSON.stringify({query}),
			})
			.then(res => res.text())
			.then(body => {
				const jsonBody = JSON.parse(body);
				resolve(jsonBody.data.userByDisplayName.username);
			})
			.catch(err => {
				reject("Failed to obtain username for dlive channel");
			});
		});
	}

	private normalize(min: number, max: number, input: number) {

		return (input - min) / (max - min);

	}

	private convertRange(x: number, y: number, a: number, b: number,input: number) {

		return ((input - x) / (y - x)) * (b - a) + a;

	}
}
