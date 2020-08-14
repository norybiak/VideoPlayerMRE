import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import Server from './server';
import getVideoDuration from 'get-video-duration';
import puppeteer from 'puppeteer';

import URL from 'url';
import fetch from 'node-fetch';

const VIDEO_PLAYER_WIDTH = 1;
const VIDEO_PLAYER_HEIGHT = 1 / (16/9);
const BUTTON_SCALE = 0.03;

interface Admins
{
	videoPlayer?: MRE.Actor,
	controls?: MRE.Actor,
	videoInstance?: MRE.MediaInstance,
	isVideoPlayerHovered: boolean,
	isControlsHovered: boolean
}

/**
 * The main class of this app. All the logic goes here.
 */
export default class VideoPlayer
{
	private assets: MRE.AssetContainer;
	private videos: MRE.AssetContainer;

	private videoPlayer: MRE.Actor;

	private admins: { [key: string]: Admins } = {};

	private video: MRE.VideoStream;
	private videoInstance: MRE.MediaInstance;
	private videoDuration: number;
	private videoTimer: NodeJS.Timer;
	private startTime: number;
	private timeRemaining: number;

	private isLiveStream: boolean = false;

	private isVideoPlaying: boolean;
	private loop: boolean = false;

	private videoPlayerMat: MRE.Material;
	private iconMat: MRE.Material;

	private texts: { [key: string]: MRE.Actor } = {};
	private activeText: string;

	constructor(private context: MRE.Context, private params: MRE.ParameterSet)
	{
		this.videos = new MRE.AssetContainer(context);
		this.assets = new MRE.AssetContainer(context);

		this.context.onStarted(() => this.init());
		this.context.onUserJoined((user) => this.handleUser(user));
	}

	/*
		Once the context is "started", initialize the app.
	*/
	private async init()
	{
		this.iconMat = this.assets.createMaterial('ControlsMaterial',
		{
			mainTextureId: this.assets.createTexture('icons', { uri: `${Server.baseUrl}/icons-white.png` }).id,
			emissiveColor: MRE.Color3.White(),
			alphaMode: MRE.AlphaMode.Blend
		});

		this.videoPlayerMat = this.assets.createMaterial('material', { color: MRE.Color3.Black() });
	}

	/*
		Check if user is a world moderator. If they are, give them admin controls.
	*/
	private handleUser(user: MRE.User)
	{
		if (this.checkUserRole(user, 'moderator'))
		{
			user.groups.set(['admin']);
			
			this.admins[user.id.toString()] =
			{
				isControlsHovered: false,
				isVideoPlayerHovered: false
			};

			this.createAdminVideoPlayer(user);
		}
		else
		{
			// Hack(?) that prevents the default video player from being created for the authoritative user
			if (!this.videoPlayer)
				this.createDefaultVideoPlayer();
		}
	}

	private createDefaultVideoPlayer()
	{
		this.videoPlayer = MRE.Actor.Create(this.context,
		{
			actor:
			{
				name: 'videoPlayerActor',
				appearance:
				{
					meshId: this.assets.createBoxMesh('box', VIDEO_PLAYER_WIDTH, VIDEO_PLAYER_HEIGHT, 0.0001).id,
					materialId: this.assets.createMaterial('material', { color: MRE.Color3.Black() }).id,
					enabled: new MRE.GroupMask(this.context, ['default'])
				},
				collider:
				{
					geometry: { shape: MRE.ColliderType.Auto}
				}
			}
		});
	}

	private async createAdminVideoPlayer(user: MRE.User)
	{
		let admin = this.admins[user.id.toString()];

		const adminVideoPlayerActor = MRE.Actor.Create(this.context,
		{
			actor:
			{
				name: 'adminPlayerActor',
				exclusiveToUser: user.id,
				appearance:
				{
					meshId: this.assets.createBoxMesh('box', VIDEO_PLAYER_WIDTH, VIDEO_PLAYER_HEIGHT, 0.0001).id,
					materialId: this.videoPlayerMat.id
				},
				collider: { geometry: { shape: MRE.ColliderType.Auto} }
			}
		});

		this.createText("ClickText", adminVideoPlayerActor.id, "Click to enter URL", MRE.Color3.White());
		this.createText("YoutubeCiphered", adminVideoPlayerActor.id, "This video cannot \n be played due \n to copyright", MRE.Color3.Red());
		this.createText("YoutubeUnplayable", adminVideoPlayerActor.id, "This video is \n not viewable \n outside of \n Youtube.com", MRE.Color3.Red());
		this.createText("InvalidUrl", adminVideoPlayerActor.id, "Invalid URL", MRE.Color3.Red());
		this.createText("Load", adminVideoPlayerActor.id, "Attempting to load", MRE.Color3.White());

		this.texts["ClickText"].appearance.enabledFor.add('admin');
		this.activeText = "ClickText";

		const adminControlsActor = MRE.Actor.Create(this.context,
		{
			actor:
			{
				name: "playerControls",
				exclusiveToUser: user.id,
				appearance: { enabled: false },
				transform: { local: { position: { x: 0, y: -(VIDEO_PLAYER_HEIGHT/2) + 1/20, z: -0.01 } } }
			}
		});

		admin.videoPlayer = adminVideoPlayerActor;
		admin.controls = adminControlsActor;

		await this.assets.loadGltf(`${Server.baseUrl}/videoPlayerControls.glb`);

		this.createButtonActor(admin, "PlayButton", -8);
		this.createButtonActor(admin, "PauseButton", -8, false);
		this.createButtonActor(admin, "StopButton",  -6);
		this.createButtonActor(admin, "RestartButton", -4);

		//Looping is currently broken
		this.createButtonActor(admin, "LoopButton", 8, false);
		this.createButtonActor(admin, "LoopGreenButton", 8);

		const behavior = admin.videoPlayer.setBehavior(MRE.ButtonBehavior);

		behavior.onHover('enter', (user) =>
		{
			admin.isVideoPlayerHovered = true;
			admin.controls.appearance.enabled = true;
		});

		behavior.onHover('exit', (user) =>
		{
			admin.isVideoPlayerHovered = false;

			//Hack to check if player controls are hovered.
			setTimeout(() =>
			{
				if (!admin.isVideoPlayerHovered && !admin.isControlsHovered)
					admin.controls.appearance.enabled = false;
			}, 500);
		});

		behavior.onClick((user) =>
		{
			if (this.checkUserRole(user, 'moderator'))
			{
				user.prompt("Enter Video URL", true).then((dialog) =>
				{
					if (dialog.submitted)
					{
						this.parseUrl(dialog.text).then((url) =>
						{
							if (url)
							{
								this.createOrUpdateVideoPlayer(url);
							}
						});
					}
				});
			}
		});
	}

	private createButtonActor(admin: Admins, theName: string, xOffset: number, isEnabled: boolean = true)
	{
		const buttonActor = MRE.Actor.Create(this.context,
		{
			actor:
			{
				name: theName,
				parentId: admin.controls.id,
				appearance:
				{
					meshId: this.assets.meshes.find(m => m.name === theName).id,
					materialId: this.iconMat.id,
					enabled: isEnabled
				},
				collider: 
				{ 
					geometry: { shape: MRE.ColliderType.Box },
					enabled: isEnabled
				},
				transform:
				{
					local:
					{
						position: { x: xOffset/20, y: 0, z: 0},
						scale: { x: BUTTON_SCALE, y: BUTTON_SCALE, z: BUTTON_SCALE },
						rotation: MRE.Quaternion.FromEulerAngles(-90 * MRE.DegreesToRadians, 0, 0)
					}
				}
			}
		});

		const behavior = buttonActor.setBehavior(MRE.ButtonBehavior);
		behavior.onHover('enter', (user) =>
		{
			admin.isControlsHovered = true;
		});

		behavior.onHover('exit', (user) =>
		{
			admin.isControlsHovered = false
		});

		behavior.onButton('released', (user) =>
		{
			if (admin.videoInstance)
				this.adminControlsButtonAction(buttonActor, user);
		});
	}

	private createText(name: string, parentId: MRE.Guid, content: string, color: MRE.Color3)
	{
		this.texts[name] = MRE.Actor.Create(this.context,
		{
			actor:
			{
				name: name,
				parentId: parentId,
				appearance:
				{
					enabled: false
				},
				text:
				{
					contents: content,
					height: 0.1,
					anchor: MRE.TextAnchorLocation.MiddleCenter,
					color: color
				},
				transform:
				{
					local:
					{
						position: { x: 0, y: 0, z: -0.01 }
					}
				}
			}
		});
	}

	private async parseUrl(input: string)
	{		
		let parsedInputAsURL = URL.parse(input, true);
		let videoUrl = parsedInputAsURL.href;

		this.showText('Load');

		if (parsedInputAsURL.protocol === null)
		{
			this.showText("InvalidUrl");
			return;
		}

		if (input.includes('tinyurl'))
		{
			videoUrl = await this.handleTinyUrl(parsedInputAsURL);
		}
		else if (input.includes('youtube'))
		{
			videoUrl = await this.handleYoutube(parsedInputAsURL);
		}
		else if (input.includes('dlive'))
		{
			videoUrl = await this.handleDLive(parsedInputAsURL);
		}

		if (input.includes('m3u8'))
		{
			this.isLiveStream = true;
		}

		return videoUrl;
	}

	/* 
		Much easier for Quest/Go users
	*/
	private async handleTinyUrl(theUrl: URL.UrlWithParsedQuery)
	{
		let tinyId = "";

		if (theUrl.protocol.includes("tinyurl"))
		{
			tinyId = theUrl.hostname;
		}
		else if (theUrl.protocol.includes("http") && theUrl.path)
		{
			tinyId = theUrl.pathname.substr(1);
		}
		else
		{
			this.showText("InvalidUrl");
			return;
		}

		let realUrl = await fetch(`https://tinyurl.com/${tinyId}`);

		//run through parseUrl with new URL
		return await this.parseUrl(realUrl.url);
	}

	
	/* 
		Fetch the youtube video id info. If it's a live stream, cool! Pass it along to the client.
		Otherwise, we need to check to make sure the video file url isn't ciphered. 
		If it is, we can't play it.
	*/
	private async handleYoutube(theUrl: URL.UrlWithParsedQuery)
	{
		let videoId = "";

		if (theUrl.protocol.includes("youtube"))
		{
			videoId = theUrl.hostname;
		}
		else if (theUrl.protocol.includes("http") && theUrl.query.v)
		{
			videoId = theUrl.query.v as string;
		}
		else
		{
			this.showText("InvalidUrl");
			return;
		}

		const response = await fetch(`https://www.youtube.com/get_video_info?video_id=${videoId}`);
		const info = await response.text();

		let videoInfo = JSON.parse(unescape(info).match(/(?<=player_response=)[^&]+/)[0]);

		if (videoInfo.playabilityStatus.status === "UNPLAYABLE")
		{
			this.showText("YoutubeUnplayable");
			return;
		}		

		if (videoInfo.streamingData.adaptiveFormats[0].cipher || videoInfo.streamingData.adaptiveFormats[0].signatureCipher)
		{
			this.showText("YoutubeCiphered");
			return;
		} 
		
		if (videoInfo.videoDetails.isLiveContent)
		{
			this.isLiveStream = true;
		}

		return `youtube://${videoId}`;
	}


	/* 
		Check to see if the streamers displayname (channel name) is the same as their username. 
		If not, we're gonna have to scrape for it, which takes longer.

		TODO: Check to see if the channel is valid.
	*/
	private async handleDLive(theUrl: URL.UrlWithParsedQuery)
	{
		let channel = "";
		
		if (theUrl.protocol.includes("dlive"))
		{
			channel = theUrl.hostname;
		}
		else if (theUrl.protocol.includes("http") && theUrl.pathname !== "")
		{
			channel = theUrl.pathname.substr(1);
		}
		else
		{
			this.showText("InvalidUrl");
			return;
		}

		let response = await fetch(`https://live.prd.dlive.tv/hls/live/${channel.toLowerCase()}.m3u8`);
		if (response.status !== 200)
		{
			channel = await this.scrapeDLive(channel.toLowerCase());
		}

		this.isLiveStream = true;

		return `https://live.prd.dlive.tv/hls/live/${channel.toLowerCase()}.m3u8`;
	}

	/* 
		Create a new video stream. We must first stop the current video instance in order to destroy it client side.
		Notice that we dont use this.start() since creating a new video instance will automatically play the video.
	*/
	private async createOrUpdateVideoPlayer(theUrl: string)
	{
		const options =
		{
			//looping: this.loop,
			rolloffStartDistance: 1,
			spread: 0.6,
			volume: 0.5,
			visible: true
		};

		this.stop();

		if (!this.video || this.video.uri !== theUrl)
		{
			this.video = this.videos.createVideoStream('videoStream', { uri: theUrl });

			await this.video.created;

			this.videoDuration = this.video.duration * 1000;

			if (theUrl.includes('webm') || theUrl.includes('mp4'))
				this.videoDuration = await getVideoDuration(theUrl) * 1000;
		}
		
		if (this.videoPlayer)
		{
			this.videoInstance = this.videoPlayer.startVideoStream(this.video.id, options);
			this.videoPlayer.appearance.enabledFor.delete('default');
		}

		for (let admin in this.admins)
		{
			this.admins[admin].videoInstance = this.admins[admin].videoPlayer.startVideoStream(this.video.id, options);
			this.admins[admin].videoPlayer.appearance.enabled = false;
		}
		
		this.isVideoPlaying = true;

		if (!this.isLiveStream)
		{
			this.startTime = Date.now();
			this.timeRemaining = this.videoDuration;
			this.createTimer();
		}		
		
		this.texts[this.activeText].appearance.enabledFor.delete('admin');
		this.activeText = "";

		this.changePlayPauseButtonState();
	}

	/* 
		Complete an action based on which button was pressed.
	*/
	private adminControlsButtonAction(button: MRE.Actor, user: MRE.User)
	{
		switch (button.name)
		{
			case 'PlayButton':
			{
				if (!this.isVideoPlaying)
					this.start();
				break;
			}

			case 'StopButton':
			{
				if (this.isVideoPlaying)
					this.stop()
				break;
			}

			case 'PauseButton':
			{
				if (this.isVideoPlaying)
					this.pause();
				break;
			}

			case 'RestartButton':
			{
				this.restart();

				break;
			}

			case 'LoopButton':
			case 'LoopGreenButton':
			{
				this.loop = !this.loop;

				this.changeLoopButtonState();

				break;
			}
	
			default:
				break;
		}
	}

	/* 
		Start the video. Start the timer based on the video duration.
	*/
	private start()
	{
		this.isVideoPlaying = true;

		this.startTime = Date.now();

		this.createTimer();

		if (this.videoInstance)
		{
			this.videoInstance.resume();
		}

		for (let admin in this.admins)
		{
			this.admins[admin].videoInstance.resume();
		}

		this.changePlayPauseButtonState();
	}

	/* 
		Stop the video. Reset the state of the play/pause buttons and show the default text.
	*/
	private stop()
	{
		this.isVideoPlaying = false;

		clearTimeout(this.videoTimer)

		if (this.videoInstance)
		{
			this.videoInstance.stop();
			this.videoPlayer.appearance.enabledFor.add('default');
		}

		for (let admin in this.admins)
		{
			if (this.admins[admin].videoInstance)
				this.admins[admin].videoInstance.stop();

			this.admins[admin].videoPlayer.appearance.enabled = true;
		}

		this.showText("ClickText");

		this.setInitialPlayPauseButtonState();
	}

	/* 
		Pause the video. Determine the new time remaining.
	*/
	private pause()
	{
		this.isVideoPlaying = false;

		clearTimeout(this.videoTimer)
		this.timeRemaining -= Date.now() - this.startTime;

		if (this.videoInstance)
		{
			this.videoInstance.pause();
		}

		for (let admin in this.admins)
		{
			this.admins[admin].videoInstance.pause();
		}

		this.changePlayPauseButtonState();
	}

	/* 
		Seek to the beginning of the video.
	*/
	private restart()
	{
		if (this.videoInstance)
		{
			this.videoInstance.setState({ time: 0 });
		}

		for (let admin in this.admins)
		{
			this.admins[admin].videoInstance.setState({ time: 0 });
		}

		this.timeRemaining = this.videoDuration;

		this.createTimer()
	}

	/* 
		We don't want to create a timer for livestreams since they never end.

		Restart or stop the video once the time remaining reaches 0
	*/
	private createTimer()
	{
		if (!this.isLiveStream)
		{
			clearTimeout(this.videoTimer)

			this.startTime = Date.now();

			this.videoTimer = setTimeout(() =>
			{
				if (this.isVideoPlaying)
				{
					if (this.loop)
					{
						this.restart();
					}
					else
					{
						this.stop();
					}
				}

			}, Math.floor(this.timeRemaining));
		}
	}

	/* 
		Resets the visibility of the play/pause buttons so that Play is showing and pause is hidden
	*/
	private setInitialPlayPauseButtonState()
	{
		for (let admin in this.admins)
		{
			let playButton = this.admins[admin].controls.findChildrenByName('PlayButton', true)[0];
			let pauseButton = this.admins[admin].controls.findChildrenByName('PauseButton', false)[0];

			playButton.appearance.enabled = true;
			playButton.collider.enabled = true;

			pauseButton.appearance.enabled = false;
			pauseButton.collider.enabled = false;
		}
	}

	/* 
		Toggles the visibilty of the play/pause buttons 
	*/
	private changePlayPauseButtonState()
	{
		for (let admin in this.admins)
		{
			let playButton = this.admins[admin].controls.findChildrenByName('PlayButton', false)[0];
			let pauseButton = this.admins[admin].controls.findChildrenByName('PauseButton', false)[0];

			playButton.appearance.enabled = !playButton.appearance.enabled
			playButton.collider.enabled = !playButton.collider.enabled;

			pauseButton.appearance.enabled = !pauseButton.appearance.enabled;
			pauseButton.collider.enabled = !pauseButton.collider.enabled;
		}
	}

	/* 
		Toggles the visibilty of the loop buttons 
	*/
	private changeLoopButtonState()
	{
		for (let admin in this.admins)
		{
			let loopButton = this.admins[admin].controls.findChildrenByName('LoopButton', false)[0];
			let loopGreenButton = this.admins[admin].controls.findChildrenByName('LoopGreenButton', false)[0];

			loopButton.appearance.enabled = !loopButton.appearance.enabled
			loopButton.collider.enabled = !loopButton.collider.enabled;

			loopGreenButton.appearance.enabled = !loopGreenButton.appearance.enabled;
			loopGreenButton.collider.enabled = !loopGreenButton.collider.enabled;
		}
	}

	private showText(type: string)
	{
		if (this.activeText !== type)
		{
			if (this.activeText)
				this.texts[this.activeText].appearance.enabledFor.delete('admin');
			
			this.texts[type].appearance.enabledFor.add('admin');
			this.activeText = type;
		}
	}

	private checkUserRole(user: MRE.User, role: string)
	{
		if (user.properties['altspacevr-roles'] === role ||
		user.properties['altspacevr-roles'].includes(role))
		{
			return true;
		}

		return false;
	}

	/*
		We can grab the streamers username by picking it out from data returned from an API call
	*/
	private async scrapeDLive(channel: string)
	{
		let username = "";

		const browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--incognito']
		});
		
		const page = await browser.newPage();

		page.setJavaScriptEnabled(true);

		const response = new Promise(resolve =>
		{
			page.on('response', (e) =>
			{
				if (e.url() === "https://graphigo.prd.dlive.tv/" && e.headers()['content-type'] === "application/json")
				{
					e.json().then((json: any) =>
					{
						if (json.data.userByDisplayName.displayname.toLowerCase() === channel)
						{
							username = json.data.userByDisplayName.username;
							resolve();
						}
					});
				}
			})
		});

		await page.goto(`https://dlive.tv/${channel}`, { waitUntil: 'networkidle0' });
		await response;
		await browser.close();
		
		return username;
	}
}