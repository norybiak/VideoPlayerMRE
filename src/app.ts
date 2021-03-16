import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import server from './server';
import getVideoDuration from 'get-video-duration';
import URL from 'url';
import fetch from 'node-fetch';
import * as TwitchStreams from 'twitch-get-stream';
import * as MREUI from './libs/UI';
import { DB, Manifest, Config, Playlist, Tracklist } from './db';

const VIDEO_PLAYER_WIDTH = 1;
const VIDEO_PLAYER_HEIGHT = 1 / (16/9);
const BUTTON_SCALE = 0.02;
const PLACEMENT_RATIO = 20;
const TRACKS_PER_PAGE = 3;
const MAX_PAGES = 10;

interface Admins {

	controls?: MRE.Actor,
	isVideoPlayerHovered: boolean,
	isControlsHovered: boolean,
	isVolumeHovered: boolean,
	isVolumeSliderHovered: boolean,
	isConfigOrPlaylistTabActive: boolean

}

interface Tracks {
	rootContainer:  MREUI.Group,
	trackRows: TrackRow[]
}

interface TrackRow {
	id: MRE.Guid,
	group: MREUI.Group,
	page: number,
	pageLabel: string
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
	private UIvideoPlayer: MREUI.Group;
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
	private UIvideoPlayerAdminControlBG: MREUI.Group;
	private UIadminControlsGroup: MREUI.Group;
	private playlistContainer: MREUI.Group;
	private currentPlaylistLabel: MREUI.Label;
	private currentPlaylistCountLabel: MREUI.Label;
	private trackPagelabel: MREUI.Label;
	private configContainer: MREUI.Group;	
	private seekSliderPuck: MRE.Actor;
	private volumeSliderPuck: MRE.Actor;
	private UItimeLabel: MREUI.Label;
	private infoLabel: MREUI.Label;
	private mediaDurationLabel: string;
	private holdingSliderPuck: boolean = false;

	private trackRootContainers: { [key: string]: Tracks } = {};
	private currentlyPlayingLabel: MREUI.Label;

	// MODERATOR UI VIDEO PLAYER TEXT
	private UIadminInfoGroup: MREUI.Group;
	private UIactiveInfo: MREUI.Label;

	//LOOP
	private tick = 10;
	private tickInterval = 1000 / this.tick;
	private expected = Date.now();

	// TIMES
	private currentTime: number;

	//DB
	private DB: DB;
	private manifest: Manifest;
	private config: Config;

	//MISC
	private increment = 10;
	private ignorePlayingTrack = false;
	private currentTrackPageGroup = 'adminTrackPage1';
	private currentTrackPage = 1;
	private totalPages = 1;

	private UIReady: Promise<void>;

	constructor(private context: MRE.Context, private params: MRE.ParameterSet) {

		this.videos = new MRE.AssetContainer(context);
		this.assets = new MRE.AssetContainer(context);

		this.UI = new MREUI.UI(this.context, {
			scale: BUTTON_SCALE
		});

		this.context.onStarted(async () => {
			this.UIReady = this.init();
		});

		this.context.onUserJoined((user) => this.handleUser(user));

	}

	/**
	 * Once the context is "started", initialize the app.
	 */
	private async init() {

		this.startLoop();
		await this.createUI();
		
	}

	private async handleUser(user: MRE.User) {

		if (this.checkUserRole(user, 'moderator')) {
			user.groups.set(['admin', 'adminShowInfo', 'adminTrackPage1']);

			this.admins[user.id.toString()] = {
				isControlsHovered: false,
				isVideoPlayerHovered: false,
				isVolumeHovered: false,
				isVolumeSliderHovered: false,
				isConfigOrPlaylistTabActive: false
			};
			
		} else {
			user.groups.set(['user']);
		}

		if (!this.DB) {

			let eventId = user.properties['altspacevr-space-id'];
			let sessionId = this.context.sessionId;
			
			this.DB = new DB(eventId, sessionId);	
			this.manifest = new Manifest(this.DB);
			this.config = new Config(this.DB);
		
			await this.UIReady;

			await this.manifest.ready;
			this.updateManifestLabelsAndIcons(user);

			await this.config.ready;
			this.updateConfigLabelsAndIcons();

			this.playTrack(this.manifest.currentVideoIndex);
			
		}

	}

	private async createUI() {

		await this.UI.loadIconPack(`${server.baseUrl}/iconPacks/media`);

		this.createVideoPlayerInfoLabels()
		await this.createVideoPlayer();
		await this.createAdminControls();

	}

	private createVideoPlayerInfoLabels() {

		this.UIadminInfoGroup = this.UI.createGroup('adminTextLayer', {
			groupScale: 0.1,
			mask: new MRE.GroupMask(this.context, ['adminShowInfo']),
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

	private async createVideoPlayer() {

		this.UIvideoPlayer = this.UI.createGroup('UIvideoPlayer', {
			actor: {
				appearance: {
					meshId: this.assets.createBoxMesh('box', VIDEO_PLAYER_WIDTH, VIDEO_PLAYER_HEIGHT, 0.0001).id,
					materialId: this.assets.createMaterial('material', { color: MRE.Color3.Black() }).id,
				}
			}
		});

		this.UIvideoPlayer.addBehavior('enter', (user) => {
			if (this.checkUserRole(user, 'moderator')) {
				let admin = this.admins[user.id.toString()];
				admin.isVideoPlayerHovered = true;
				user.groups.add('adminShowControls');
			}
		});

		this.UIvideoPlayer.addBehavior('exit', (user) => {
			if (this.checkUserRole(user, 'moderator')) {
				let admin = this.admins[user.id.toString()];
				admin.isVideoPlayerHovered = false;

				setTimeout(() => {
					if (!admin.isVideoPlayerHovered && !admin.isControlsHovered && !admin.isConfigOrPlaylistTabActive) {
						user.groups.delete('adminShowControls');
					}	
				}, 1000);
			}
		});

		this.UIvideoPlayer.addBehavior('click', (user) => {
			if (this.checkUserRole(user, 'moderator')) {
				user.prompt("Enter Video URL", true).then((dialog) => {
					if (dialog.submitted) {
						this.stop();
						this.parseUrl(dialog.text).then(track => {
							if (track.url) {
								this.createOrUpdateVideoPlayer(track.url);
								this.manifest.updateCurrentVideo(track.url);
							}
						});
					}
				});
			}
		});


		this.UIvideoPlayerAdminControlBG = this.UI.createGroup('UIvideoPlayerAdminControlBG', {
			actor: {
				appearance: {
					meshId: this.assets.createBoxMesh('box', VIDEO_PLAYER_WIDTH, VIDEO_PLAYER_HEIGHT, 0.0001).id,
					materialId: this.assets.createMaterial('material', { color: MRE.Color3.Gray() }).id,
					enabled: new MRE.GroupMask(this.context, ['adminControlsBG'])
				}
			}
		});

		await this.UIvideoPlayer.actor.created();

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

		await this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.Play, {
			name: "playBtn",
			position: { x: -9/20 }
		}).addBehavior('released', () => this.play()).created();

		await this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.Pause, {
			name: "pauseBtn",
			enabled: false,
			position: { x: -9/20 }
		}).addBehavior('released', () => this.pause()).created();

		this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.Stop, {
			name: "stopBtn",
			position: { x: -7.5/20 }
		}).addBehavior('released', () => this.stop());

		this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.Restart, {
			name: "restartBt",
			position: { x: -6/20 }
		}).addBehavior('released', () => this.restart());

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
			position: { x: 7.5 / PLACEMENT_RATIO}
		});
		
		muteBtn.addBehavior('released', (user) => {
			this.mute(false);
			volumeBtn.show();
			volumeBtn.enableCollider();
			muteBtn.hide();
			muteBtn.disableCollider();
		});

		let playlistsLabel = this.UIadminControlsGroup.createLabel('', {
			position: { x: 9 / PLACEMENT_RATIO, y: -1.5 / PLACEMENT_RATIO },
			enabled: false 
		});

		this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.Playlist, { 
			position: { x: 9 / PLACEMENT_RATIO  }
		}).addBehavior('released', (user) => this.togglePlaylist(user))
		.addBehavior('enter', () => playlistsLabel.show())
		.addBehavior('exit', () => playlistsLabel.hide());
		
		let configLabel = this.UIadminControlsGroup.createLabel('', {
			position: { x: 9 / PLACEMENT_RATIO, y: -1.5 / PLACEMENT_RATIO },
			enabled: false,	
		});

		this.UIadminControlsGroup.createIcon(MREUI.MediaIcons.Config, {
			position: { x: 9 / PLACEMENT_RATIO, y: 1.5 / PLACEMENT_RATIO  }
		}).addBehavior('released', (user) => this.toggleConfig(user))
		.addBehavior('enter', () => configLabel.show())
		.addBehavior('exit', () => configLabel.hide());


		this.playlistContainer = this.UI.createGroup('mediaContainer', {
			position: { y: 9 / PLACEMENT_RATIO },
			enabled: false,
			parentId: this.UIadminControlsGroup.actor.id,
		});

		this.currentPlaylistLabel = this.playlistContainer.createLabel('', {
			position: { x: -9.5 / PLACEMENT_RATIO },
			height: 1.5,
			anchor: MRE.TextAnchorLocation.MiddleLeft,
			justify: MRE.TextJustify.Left,
		});

		let deletePlaylistLabel = this.playlistContainer.createLabel('Delete Playlist', {
			enabled: false,
			position: { x: 8 / PLACEMENT_RATIO, y: -1.5 / PLACEMENT_RATIO }
		});

		this.playlistContainer.createIcon(MREUI.MediaIcons.Delete, {
			position: { x: 9 / PLACEMENT_RATIO }
		}).addBehavior('released', (user) => this.promptDelete(user))
		.addBehavior('enter', () => deletePlaylistLabel.show())
		.addBehavior('exit', () => deletePlaylistLabel.hide())

		let createPlaylistlabel = this.playlistContainer.createLabel('Create Playlist', {
			enabled: false, 
			position: { x: 8 / PLACEMENT_RATIO, y: -1.5 / PLACEMENT_RATIO }
		});

		this.playlistContainer.createIcon(MREUI.MediaIcons.Add, {
			position: { x: 7 / PLACEMENT_RATIO }
		}).addBehavior('released', (user) => this.promptAddPlaylist(user))
		.addBehavior('enter', () => createPlaylistlabel.show())
		.addBehavior('exit', () => createPlaylistlabel.hide())

		this.playlistContainer.createIcon(MREUI.MediaIcons.NextPage, {
			position: { x: 5 / PLACEMENT_RATIO }
		}).addBehavior('released', () => this.nextPlaylist());

		this.currentPlaylistCountLabel = this.playlistContainer.createLabel('0/0', {
			position: { x: 3 / PLACEMENT_RATIO }
		});

		this.playlistContainer.createIcon(MREUI.MediaIcons.PreviousPage, {
			position: { x: 1 / PLACEMENT_RATIO }
		}).addBehavior('released', () => this.previousPlaylist());

		
		let addTracklabel = this.playlistContainer.createLabel('Add Track', {
			position: { x: -8.5 / PLACEMENT_RATIO, y: -1 / PLACEMENT_RATIO },
			enabled: false
		});

		this.playlistContainer.createIcon(MREUI.MediaIcons.Add, {
			position: { x: -9 / PLACEMENT_RATIO, y: -2 / PLACEMENT_RATIO  }
		}).addBehavior('released', (user) => this.promptAddTrack(user))
		.addBehavior('enter', () => addTracklabel.show())
		.addBehavior('exit', () => addTracklabel.hide())

		this.playlistContainer.createIcon(MREUI.MediaIcons.PreviousPage, {
			position: { x: -7.5 / PLACEMENT_RATIO, y: -2 / PLACEMENT_RATIO  }
		}).addBehavior('released', (user) => this.changeTrackPage(-1, user));

		this.trackPagelabel = this.playlistContainer.createLabel('Page 1/1', {
			position: { x: -5.5 / PLACEMENT_RATIO, y: -2 / PLACEMENT_RATIO }
		});

		this.playlistContainer.createIcon(MREUI.MediaIcons.NextPage, {
			position: { x: -3.5 / PLACEMENT_RATIO, y: -2 / PLACEMENT_RATIO  }
		}).addBehavior('released', (user) => this.changeTrackPage(1, user));

		this.configContainer = this.UI.createGroup('configContainer', {
			enabled: false,
			position: { y: 9 / PLACEMENT_RATIO },
			parentId: this.UIadminControlsGroup.actor.id
		});

		let rolloffLabel = this.configContainer.createLabel(`Rolloff Distance: ${ this.config.spread }m`, {
			name: 'rolloffLabel',
			position: { x: -4 / PLACEMENT_RATIO },
			anchor: MRE.TextAnchorLocation.MiddleLeft,
			justify: MRE.TextJustify.Left,
		});

		this.configContainer.createIcon(MREUI.MediaIcons.Subtract, {
			position: { x: -8 / PLACEMENT_RATIO }
		}).addBehavior('released', () => {

			let increment = this.increment;
			if (this.config.rolloffDistance <= 10)
			{
				increment = 1;
			} 
			else if (this.config.rolloffDistance > 300)
			{
				increment = 50;
			}

			if (this.config.rolloffDistance > 0) {
				this.config.rolloffDistance = this.config.rolloffDistance - increment;
				rolloffLabel.set(`Rolloff Distance: ${ this.config.rolloffDistance }m`);
			}

			this.setRolloffDistance(this.config.rolloffDistance);
		});

		this.configContainer.createIcon(MREUI.MediaIcons.Add, {
			position: { x: -6 / PLACEMENT_RATIO }
		}).addBehavior('released', () => {

			let increment = this.increment;
			if (this.config.rolloffDistance < 10)
			{
				increment = 1;
			}
			else if (this.config.rolloffDistance >= 300)
			{
				increment = 50;
			}

			this.config.rolloffDistance = this.config.rolloffDistance + increment;
			rolloffLabel.set(`Rolloff Distance: ${ this.config.rolloffDistance }m`);
			this.setRolloffDistance(this.config.rolloffDistance);
		});

		let spreadLabel = this.configContainer.createLabel(`Spread: ${ this.config.spread }`, {
			name: 'spreadLabel',
			position: { x: -4 / PLACEMENT_RATIO, y: -2 / PLACEMENT_RATIO },
			anchor: MRE.TextAnchorLocation.MiddleLeft,
			justify: MRE.TextJustify.Left,
		});

		this.configContainer.createIcon(MREUI.MediaIcons.Subtract, {
			position: { x: -8 / PLACEMENT_RATIO, y: -2 / PLACEMENT_RATIO }
		}).addBehavior('released', () => {
			if (this.config.spread > 0) {
				this.config.spread = Math.round((this.config.spread - 0.1) * 10) / 10;
				spreadLabel.set(`Spread: ${ this.config.spread }`);
			}
			this.setSpread(this.config.spread);
		});

		this.configContainer.createIcon(MREUI.MediaIcons.Add, {
			position: { x: -6 / PLACEMENT_RATIO, y: -2 / PLACEMENT_RATIO }
		}).addBehavior('released', () => {
			if (this.config.spread < 1) {
				this.config.spread = Math.round((this.config.spread + 0.1) * 10) / 10;
				spreadLabel.set(`Spread: ${ this.config.spread }`);
			}

			this.setSpread(this.config.spread);
		});

		this.configContainer.createLabel(`Loop: ${ this.config.loop }`, {
			name: 'loopLabel',
			position: { x: -4 / PLACEMENT_RATIO, y: -4 / PLACEMENT_RATIO },
			anchor: MRE.TextAnchorLocation.MiddleLeft,
			justify: MRE.TextJustify.Left,
		});

		this.configContainer.createIcon(MREUI.MediaIcons.LoopOn, {
			name: "loopOnBtn",
			enabled: false,
			position: { x: -7 / PLACEMENT_RATIO, y: -4 / PLACEMENT_RATIO }
		}).addBehavior('released', () => this.toggleLoop());

		this.configContainer.createIcon(MREUI.MediaIcons.LoopOff, {
			name: "loopOffBtn",
			position: { x: -7 / PLACEMENT_RATIO, y: -4 / PLACEMENT_RATIO }
		}).addBehavior('released', () => this.toggleLoop());

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

	private async parseUrl(input: string): Promise<Tracklist> {

		let parsedInputAsURL = URL.parse(input, true);

		this.showLabel('Load');

		this.isLiveStream = false;

		let track: Tracklist;

		if (parsedInputAsURL.protocol === null) {
			this.showLabel("InvalidUrl");
			return;
		}
		if (input.includes('tinyurl')) {
			track = await this.handleTinyUrl(parsedInputAsURL);
		}
		else if (input.includes('youtube')) {
			track = await this.handleYoutube(parsedInputAsURL);
		}
		else if (input.includes('dlive')) {
			track = await this.handleDLive(parsedInputAsURL);
		}
		else if (input.includes('twitch')) {
			track = await this.handleTwitch(parsedInputAsURL);
		} else {
			track = { url: parsedInputAsURL.href, title: parsedInputAsURL.href }
		}

		if (input.includes('m3u8')) {
			this.isLiveStream = true;
		}

		return track;

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

		let videoId, url, title = "";

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
		title = videoInfo.videoDetails.title.replace(/\+/g, ' ');

		console.log(JSON.stringify(videoInfo.streamingData, null, 4));

		if (videoInfo.playabilityStatus.status.includes('UNPLAYABLE')) {
			this.showLabel("YoutubeUnplayable");
			return;
		}

		if (videoInfo.videoDetails.isLiveContent && videoInfo.videoDetails.isLive) {
			this.isLiveStream = true;

			if (videoInfo.streamingData.hlsManifestUrl) {
				url = videoInfo.streamingData.hlsManifestUrl;
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
		else {
			url = videoInfo.streamingData.formats[0].url;	
		}

		let track: Tracklist = { url, title };
		return track;

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

		let track: Tracklist = { url: url, title: `DLive: ${ channel }`};
		return track;
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

		let track: Tracklist = { url: shortenedm3u8Url, title: `DLive: ${ channel }`};
		return track;

	}

	private async createOrUpdateVideoPlayer(theUrl: string) {

		let volume = this.volume;
		if (this.muted) {
			volume = 0;
		}

		const options = {
			//looping: this.loop,
			rolloffStartDistance: this.config.rolloffDistance,
			spread: this.config.spread,
			volume: volume,
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

		if (this.UIvideoPlayer.actor) {	
			this.videoInstance = this.UIvideoPlayer.actor.startVideoStream(this.videoStream.id, options);
			this.UIvideoPlayer.hide()
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
		this.togglePlayPauseButtonState();

	}

	private play() { 

		if (this.videoInstance) {
			if (!this.isVideoPlaying) {
				this.isVideoPlaying = true;
			
				this.videoInstance.resume();
				this.togglePlayPauseButtonState();
			}
		} else {
			this.playTrack(this.manifest.currentVideoIndex);
		}

	}

	private stop() {

		if (this.videoInstance) {
			this.isVideoPlaying = false;
			this.isLiveStream = false;

			this.videoInstance.stop();
			this.videoInstance = null;

			this.UIvideoPlayer.show();
		
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
				this.togglePlayPauseButtonState();
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

	private setVolume(volume: number) {

		if (this.videoInstance) {
			this.videoInstance.setState({  volume: this.config.volume / 100 });
		}

	}

	private setSpread(spread: number) {

		if (this.videoInstance) {
			this.videoInstance.setState({  spread: spread });
		}

		this.config.save();

	}

	private setRolloffDistance(rolloff: number) {

		if (this.videoInstance) {
			this.videoInstance.setState({  rolloffStartDistance: rolloff});
		}

		this.config.save();

	}

	private togglePlaylist(user: MRE.User)
	{
		let admin = this.admins[user.id.toString()];

		if (this.configContainer.actor.appearance.enabled) {
			this.configContainer.hide();
			this.configContainer.disableCollider();
		} else {
			admin.isConfigOrPlaylistTabActive = !admin.isConfigOrPlaylistTabActive;
		}
		
		if (admin.isConfigOrPlaylistTabActive) {
			user.groups.delete('adminShowInfo');
			user.groups.add('adminControlsBG');
		} else {
			user.groups.add('adminShowInfo');
			user.groups.delete('adminControlsBG');
		}

		this.playlistContainer.toggleVisibility();
		this.playlistContainer.toggleCollider();

		let playlist = this.manifest.getCurrentPlaylist();
		let trackRows = this.trackRootContainers[playlist.name].trackRows;

		trackRows.forEach((trackRow) => {
			if (trackRow.page !== this.currentTrackPage) {
				trackRow.group.disableCollider();
			}
		});

	}

	private toggleConfig(user: MRE.User) {

		let admin = this.admins[user.id.toString()];

		if (this.playlistContainer.actor.appearance.enabled) {
			this.playlistContainer.hide();
			this.playlistContainer.disableCollider();
		} else {
			admin.isConfigOrPlaylistTabActive = !admin.isConfigOrPlaylistTabActive;
		}

		if (admin.isConfigOrPlaylistTabActive) {
			user.groups.delete('adminShowInfo');
			user.groups.add('adminControlsBG');
		} else {
			user.groups.add('adminShowInfo');
			user.groups.delete('adminControlsBG');
		}

		this.configContainer.toggleVisibility();
		this.configContainer.toggleCollider();
	}

	private toggleLoop() {

		this.config.loop = !this.config.loop;

		let loopOnBtn = this.configContainer.getIconByName('loopOnBtn');
		let loopOffBtn = this.configContainer.getIconByName('loopOffBtn');

		loopOnBtn.toggleVisibility();
		loopOffBtn.toggleVisibility();

		loopOnBtn.toggleCollider();
		loopOffBtn.toggleCollider();

		this.configContainer.getLabelByName('loopLabel').set(`Loop: ${ this.config.loop }`);

		this.config.save();

	}

	private promptAddPlaylist(user: MRE.User) {

		user.prompt("Create a new playlist", true).then((dialog) => {
			if (dialog.submitted) {
				this.createPlaylist(dialog.text, user);
			}
		});

	}

	private promptAddTrack(user: MRE.User) {
		
		if (this.manifest.playlists.length === 0) {
			this.displayInfo('You must create a playlist first!', 5);
			return;
		}

		user.prompt("Enter a video URL", true).then((dialog) => {
			if (dialog.submitted) {
				this.parseUrl(dialog.text).then(track => {
					if (track) {
						this.addTrack(track, user);
					}
				});
			}
		});
	
	}

	private promptDelete(user: MRE.User) {

		if (this.manifest.playlists.length === 0) {
			this.displayInfo('Nothing to delete!', 5);
			return;
		}

		user.prompt("Are you sure you want to delete the current playlist? Changes are permanent.", false).then((dialog) => {
			if (dialog.submitted) {
				this.deleteCurrentPlaylist();
			}
		});

	}

	private async updateManifestLabelsAndIcons(user: MRE.User)
	{
		for (let i = 0; i < this.manifest.playlists.length; i++)
		{	
			this.createPlaylistTrackRows(this.manifest.playlists[i], user);
		}
			
		this.changeCurrentPlaylistLabel();

		this.setInitialPlayPauseButtonState();

	}

	private updateConfigLabelsAndIcons()
	{
		this.configContainer.getLabelByName('rolloffLabel').set(`Rolloff Distance: ${ this.config.rolloffDistance }m`);
		this.configContainer.getLabelByName('spreadLabel').set(`Spread: ${ this.config.spread }`);
		this.configContainer.getLabelByName('loopLabel').set(`Loop: ${ this.config.loop }`);

		let loopOnBtn = this.configContainer.getIconByName('loopOnBtn');
		let loopOffBtn = this.configContainer.getIconByName('loopOffBtn');

		if (this.config.loop === true) {
			loopOnBtn.show()
			loopOffBtn.hide();

			loopOnBtn.enableCollider()
			loopOffBtn.disableCollider();
		} else {
			loopOnBtn.hide()
			loopOffBtn.show();

			loopOnBtn.disableCollider();
			loopOffBtn.enableCollider();
		}

		let volumePosX = this.convertRange(0, 100, -8, 8, this.config.volume);
		this.volumeSliderPuck.transform.local.position.x = volumePosX;
	
	}

	private changeCurrentPlaylist(index: number)
	{		
		let currentName = this.manifest.getCurrentPlaylist().name;

		this.manifest.currentPlaylistIndex = index;
		this.manifest.currentVideoIndex = 0;

		if (this.manifest.playlists.length > 0)
		{
			this.trackRootContainers[currentName].rootContainer.hide();
			this.trackRootContainers[currentName].rootContainer.disableCollider();

			this.changeCurrentPlaylistLabel();

			this.playTrack(this.manifest.currentVideoIndex);
		}

		this.manifest.save();
	}

	private changeCurrentPlaylistLabel()
	{
		
		if (this.manifest.playlists.length === 0)
		{
			return;
		}
	
		let label = `${this.manifest.getCurrentPlaylist().name}`;
		let playlistCount = `${this.manifest.currentPlaylistIndex+1}/${this.manifest.playlists.length}`;

		this.currentPlaylistLabel.set(label);
		this.currentPlaylistCountLabel.set(playlistCount);

		this.upatePageLabel();
	
		this.trackRootContainers[label].rootContainer.show();
	}

	private upatePageLabel() {

		let playlist = this.manifest.getCurrentPlaylist();
		let trackRows = this.trackRootContainers[playlist.name].trackRows;
		
		let pages = Math.ceil(trackRows.length / 3);

		if (pages === 0) {
			pages = 1;
		}

		this.totalPages = pages;

		let pageCount = `Page ${this.currentTrackPage}/${pages}`;

		this.trackPagelabel.set(pageCount);
	}

	private createPlaylist(name: string, user: MRE.User) {

		let newPlaylist = this.manifest.createPlaylist(name);

		this.createPlaylistTrackRows(newPlaylist, user);

		this.changeCurrentPlaylist(this.manifest.playlists.length-1);

		this.manifest.save();
	}

	private deleteCurrentPlaylist()
	{
		let playlist = this.manifest.getCurrentPlaylist();

		if (this.trackRootContainers[playlist.name].rootContainer !== undefined)
		{
			this.trackRootContainers[playlist.name].rootContainer.actor.destroy();
		}
		
		delete this.trackRootContainers[playlist.name];
		this.manifest.playlists.splice(this.manifest.currentPlaylistIndex, 1);

		if (this.manifest.currentPlaylistIndex > this.manifest.playlists.length-1)
		{
			this.manifest.currentPlaylistIndex = 0;
		}

		if (this.manifest.playlists.length === 0)
		{
			this.currentPlaylistLabel.set('');
			this.currentPlaylistCountLabel.set('0/0');

			if (this.isVideoPlaying)
				this.stop();
			
			this.ignorePlayingTrack = true;
		}
		else
		{
			this.changeCurrentPlaylist(this.manifest.currentPlaylistIndex);
		}
		
		this.manifest.save();
	}

	private playTrack(index: number) {

		if (this.manifest.playlists.length === 0) {
			return;
		}

		let track = this.getTrack(index);
		if (track) {
			this.manifest.currentVideoIndex = index;

			if (this.videoInstance) {
				this.videoInstance.stop();
			}
			
			this.createOrUpdateVideoPlayer(track.url);

			this.manifest.save();
		}

	}

	private getTrack(index: number)
	{
		if (this.manifest.playlists.length === 0)
		{
			return;
		}

		return this.manifest.getCurrentPlaylist().trackList[index];
	}

	private changeTrackPage(page: number, user: MRE.User) {

		let playlist = this.manifest.getCurrentPlaylist();
		let trackRows = this.trackRootContainers[playlist.name].trackRows;

		let pages = Math.ceil(trackRows.length / 3);

		if (pages === 0) {
			pages = 1;
		}

		if ((this.currentTrackPage + page) <= 0 || (this.currentTrackPage + page) > pages) {
			return;
		} 

		trackRows.forEach((trackRow) => {
			if (trackRow.page === this.currentTrackPage) {
				trackRow.group.disableCollider();
			}
		});

		this.currentTrackPage += page;

		trackRows.forEach((trackRow) => {
			if (trackRow.page === this.currentTrackPage) {
				trackRow.group.enableCollider();
			}
		});

		user.groups.delete(this.currentTrackPageGroup);
		this.currentTrackPageGroup = `adminTrackPage${ this.currentTrackPage }`;
		user.groups.add(this.currentTrackPageGroup);

		this.upatePageLabel();
	}

	private addTrack(track: Tracklist, user: MRE.User)
	{
		let playlist = this.manifest.getCurrentPlaylist();
		
		playlist.trackList.push(track);
		this.createPlaylistTrackRows({ name: playlist.name, trackList: [track] }, user);

		if (playlist.trackList.length === 1)
		{
			this.playTrack(0);
		}

		this.manifest.save();

		this.upatePageLabel();
	}

	private deleteTrack(id: MRE.Guid, user: MRE.User)
	{
		let playlist = this.manifest.getCurrentPlaylist();
		let trackList = playlist.trackList;
		let trackRows = this.trackRootContainers[playlist.name].trackRows;

		let indexToDelete = trackRows.findIndex((track) => track.id === id);

		if (trackRows.length > 1)
		{
			for (let i = indexToDelete+1; i < trackRows.length; i++)
			{
				this.moveTrackUp(trackRows[i].id, user);
			}
		}
		
		trackRows.pop().group.actor.destroy();
		trackList.pop();
		 
		if (this.manifest.currentVideoIndex > trackList.length-1)
		{
			this.manifest.currentVideoIndex = 0;
		}

		if (trackRows.length === 0)
		{
			this.trackRootContainers[playlist.name].trackRows = [];

			this.totalPages = 1;

			this.ignorePlayingTrack = true;
		}

		this.manifest.save();
		
		this.upatePageLabel();
	}

	private moveTrackUp(id: MRE.Guid, user: MRE.User)
	{
		let playlist = this.manifest.getCurrentPlaylist();
		let trackRows = this.trackRootContainers[playlist.name].trackRows;

		let fromIndex = trackRows.findIndex((track) => track.id === id);
		let toIndex = fromIndex-1;
		this.swapTracks(fromIndex, toIndex, user);

	}

	private moveTrackDown(id: MRE.Guid, user: MRE.User)
	{
		let playlist = this.manifest.getCurrentPlaylist();
		let trackRows = this.trackRootContainers[playlist.name].trackRows;

		let fromIndex = trackRows.findIndex((track) => track.id === id);
		let toIndex = fromIndex+1;
		this.swapTracks(fromIndex, toIndex, user);

	}

	private swapTracks(fromIndex: number, toIndex: number, user: MRE.User)
	{
		let playlist = this.manifest.getCurrentPlaylist();
		let trackList = playlist.trackList;
		let trackRows = this.trackRootContainers[playlist.name].trackRows;

		let fromTrackRow = trackRows[fromIndex];
		let toTrackRow = trackRows[toIndex];

		if (trackList.length > 1 && toIndex <= trackList.length-1 && toIndex >= 0) {	

			let fromTrackRowPos = new MRE.Vector3().copy(fromTrackRow.group.actor.transform.local.position);
			let toTrackRowPos = new MRE.Vector3().copy(toTrackRow.group.actor.transform.local.position); 

			fromTrackRow.group.actor.transform.local.position.copyFrom(toTrackRowPos);
			toTrackRow.group.actor.transform.local.position.copyFrom(fromTrackRowPos);

			if (fromTrackRow.page !== toTrackRow.page) {
				trackRows[fromIndex].group.actor.appearance.enabledFor.clear();
				trackRows[fromIndex].group.actor.appearance.enabledFor.add(toTrackRow.pageLabel);
				trackRows[fromIndex].group.enableCollider();

				trackRows[toIndex].group.actor.appearance.enabledFor.clear();
				trackRows[toIndex].group.actor.appearance.enabledFor.add(fromTrackRow.pageLabel);
				trackRows[toIndex].group.disableCollider();
			} else {
				trackRows[fromIndex].group.actor.animateTo({ transform: { local: { position: toTrackRowPos } } }, 0.5, MRE.AnimationEaseCurves.EaseInOutSine);
				trackRows[toIndex].group.actor.animateTo({ transform: { local: { position: fromTrackRowPos } } }, 0.5, MRE.AnimationEaseCurves.EaseInOutSine);
			}
			
			this.swapTrackRows(fromTrackRow, toTrackRow);

			this.swapElementsInArray(trackList, fromIndex, toIndex);
			this.swapElementsInArray(trackRows, fromIndex, toIndex);

			this.manifest.save();
		}
	}

	private swapTrackRows(fromTrackRow: TrackRow, toTrackRow: TrackRow) {

		let tempPage = fromTrackRow.page;
		let tempPageLabel = fromTrackRow.pageLabel;
		
		fromTrackRow.page = toTrackRow.page;
		fromTrackRow.pageLabel = toTrackRow.pageLabel;

		toTrackRow.page = tempPage;
		toTrackRow.pageLabel = tempPageLabel;

	}

	private createPlaylistTrackRows(playlist: Playlist, user: MRE.User) {

		let tracksRootContainer: MREUI.Group;
		let yOffset = -2;

		if (this.trackRootContainers[playlist.name] !== undefined)
		{
			if (this.trackRootContainers[playlist.name].rootContainer !== undefined)
			{
				tracksRootContainer = this.trackRootContainers[playlist.name].rootContainer;
			}
			
			if (this.trackRootContainers[playlist.name].trackRows !== undefined)
			{
				yOffset -= ((this.trackRootContainers[playlist.name].trackRows.length % TRACKS_PER_PAGE) * 1.5);
			}
		}
		else
		{
			tracksRootContainer = this.UI.createGroup('tracksRootGroup', {
				name: "trackListRootLabel",
				enabled: this.playlistContainer.actor.appearance.enabled as boolean,
				position: { x: 0, y: -2 / PLACEMENT_RATIO, z: 0 },
				parentId: this.playlistContainer.actor.id,
			});

			this.trackRootContainers[playlist.name] = { rootContainer: tracksRootContainer, trackRows: [ ] };
		}
/*
		let totalPages = Math.ceil(this.manifest.getCurrentPlaylist().trackList.length / 3);
		
		if (totalPages === 0) {
			totalPages += 1;
		}
		*/
		if (playlist.trackList.length > 0) {

			for (let i = 0; i < playlist.trackList.length; i++) {

				let id = MRE.newGuid();

				let trackRows = this.trackRootContainers[playlist.name].trackRows;

				if (i % TRACKS_PER_PAGE === 0) {

					if (Number.isInteger(trackRows.length / 3) && trackRows.length !== 0) {
						this.totalPages++;
						yOffset = -2;
					}
				}

				let name = `trackRow${trackRows.length+i}`;

				let trackRow = this.UI.createGroup('trackRowGroup', {
					name: name,
					position: { y: yOffset / PLACEMENT_RATIO },
					parentId: tracksRootContainer.actor.id,
					mask: new MRE.GroupMask(this.context, [`adminTrackPage${this.totalPages}`]),
				});
				
				let label = playlist.trackList[i].title.substr(0, 74);

				trackRow.createLabel(label, {
					anchor: MRE.TextAnchorLocation.MiddleLeft,
					justify: MRE.TextJustify.Left,
					position: { x: -5 / PLACEMENT_RATIO }
				});

				trackRow.createIcon(MREUI.MediaIcons.Delete, {
					position: { x: -9 / PLACEMENT_RATIO }
				}).addBehavior('released', (user) => this.deleteTrack(id, user));

				trackRow.createIcon(MREUI.MediaIcons.UpArrow, {
					position: { x: -7.5 / PLACEMENT_RATIO }
				}).addBehavior('released', (user) => this.moveTrackUp(id, user));

				trackRow.createIcon(MREUI.MediaIcons.DownArrow, {
					position: { x: -6.5 / PLACEMENT_RATIO }
				}).addBehavior('released', (user) => this.moveTrackDown(id, user));

				yOffset -= 1.5;

				trackRow.disableCollider();

				let admin = this.admins[user.id.toString()];

				if (this.totalPages === 1 && admin !== undefined && admin.isConfigOrPlaylistTabActive) {
					trackRow.enableCollider();
				}
				
				let newTrackRow: TrackRow = {
					id: id,
					group: trackRow,
					page: this.totalPages,
					pageLabel: `adminTrackPage${this.totalPages}`
				};

				this.trackRootContainers[playlist.name].trackRows.push(newTrackRow);
			}
		}

	}

	private previousPlaylist() {
		if (this.manifest.playlists.length === 0) {
			return;
		}

		let index = this.manifest.currentPlaylistIndex - 1;
		if (this.indexInBounds(index, this.manifest.playlists.length)) {
			this.changeCurrentPlaylist(index);
		}

	}

	private nextPlaylist() {
		if (this.manifest.playlists.length === 0) {
			return;
		}

		let index = this.manifest.currentPlaylistIndex + 1;
		if (this.indexInBounds(index, this.manifest.playlists.length)) {	
			this.changeCurrentPlaylist(index);
		}

	}

	private setInitialPlayPauseButtonState() {

		let playBtn = this.UIadminControlsGroup.getIconByName('playBtn');
		let pauseBtn = this.UIadminControlsGroup.getIconByName('pauseBtn');

		playBtn.show();
		playBtn.enableCollider();

		pauseBtn.hide();
		pauseBtn.disableCollider();
		
	}

	private togglePlayPauseButtonState() {

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

	private displayInfo(text: string, duration?: number) {

		this.infoLabel.set(text);

		if (duration && duration > 0)
		{
			setTimeout(() => {
				this.infoLabel.clear();
			}, duration * 1000);
		}

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

		if (this.isVideoPlaying && !this.isLiveStream) {
			this.currentTime += this.tickInterval;

			let minutes = '0' + Math.floor((this.currentTime / (1000*60)) % 60);
			let seconds = '0' + Math.floor((this.currentTime / 1000) % 60);

			this.UItimeLabel.set(`${ minutes.slice(-2) }:${ seconds.slice(-2) } / ${this.mediaDurationLabel}`);

			let convertedRange = this.convertRange(0, this.videoDuration, -8, 8, this.currentTime);

			if (!this.holdingSliderPuck) {
				let pos = { transform: { local: { position: { x: convertedRange, y: 0, z: -0.1 } } } };
				this.seekSliderPuck.animateTo(pos, 0.01, MRE.AnimationEaseCurves.Linear);
			}
			
			if ((this.currentTime >= (this.videoDuration - 500))) {
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

	private indexInBounds(index: number, length: number) {	

		if (index < 0) {
			return false;
		} else if (index > length-1) {
			return false;
		}

		return true;

	}

	private swapElementsInArray(input: any, indexA: number, indexB: number) {

		let temp = input[indexA];
	
		input[indexA] = input[indexB];
		input[indexB] = temp;

	}

}
