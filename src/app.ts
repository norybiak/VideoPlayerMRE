import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import Server from './server';
import getVideoDuration from 'get-video-duration';
import URL from 'url';
import fetch from 'node-fetch';

const VIDEO_PLAYER_WIDTH = 1;
const VIDEO_PLAYER_HEIGHT = 1 / (16/9);
const BUTTON_SCALE = 0.03;

interface Admins
{
	controls?: MRE.Actor,
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

	private admins: { [key: string]: Admins } = {};

	private videoPlayerActor: MRE.Actor;

	private videoStream: MRE.VideoStream;
	private videoInstance: MRE.MediaInstance;
	private videoDuration: number;

	private videoTimer: NodeJS.Timer;
	private startTime: number;
	private timeRemaining: number;

	private isVideoPlaying: boolean;
	private loop: boolean = false;
	private isLiveStream: boolean = false;

	private videoPlayerActorMat: MRE.Material;
	private iconsMat: MRE.Material;

	private adminTextLayer: MRE.Actor;
	private adminTextActors: { [key: string]: MRE.Actor } = {};
	private adminActiveText: string;

	constructor(private context: MRE.Context, private params: MRE.ParameterSet)
	{
		this.videos = new MRE.AssetContainer(context);
		this.assets = new MRE.AssetContainer(context);

		this.context.onStarted(() => this.init());
		this.context.onUserJoined((user) => this.handleUser(user));
	}

	/**
	 * Once the context is "started", initialize the app.
	 */
	private async init()
	{
		this.iconsMat = this.assets.createMaterial('ControlsMaterial',
		{
			mainTextureId: this.assets.createTexture('icons', { uri: `${Server.baseUrl}/icons-white.png` }).id,
			emissiveColor: MRE.Color3.White(),
			alphaMode: MRE.AlphaMode.Blend
		});

		this.videoPlayerActorMat = this.assets.createMaterial('material', { color: MRE.Color3.Black() });

		this.createVideoPlayerActors();
	}

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

			this.createAdminController(user);
		}
	}

	private createVideoPlayerActors()
	{
		this.videoPlayerActor = MRE.Actor.Create(this.context,
		{
			actor:
			{
				name: 'videoPlayerActorActor',
				appearance:
				{
					meshId: this.assets.createBoxMesh('box', VIDEO_PLAYER_WIDTH, VIDEO_PLAYER_HEIGHT, 0.0001).id,
					materialId: this.assets.createMaterial('material', { color: MRE.Color3.Black() }).id,
				},
				collider:
				{
					geometry: { shape: MRE.ColliderType.Auto}
				}
			}
		});

		const behavior = this.videoPlayerActor.setBehavior(MRE.ButtonBehavior);

		behavior.onHover('enter', (user) =>
		{
			if (this.checkUserRole(user, 'moderator'))
			{
				let admin = this.admins[user.id.toString()];
				admin.isVideoPlayerHovered = true;
				admin.controls.appearance.enabled = true;
			}
		});

		behavior.onHover('exit', (user) =>
		{
			if (this.checkUserRole(user, 'moderator'))
			{
				let admin = this.admins[user.id.toString()];
				admin.isVideoPlayerHovered = false;

				setTimeout(() =>
				{
					if (!admin.isVideoPlayerHovered && !admin.isControlsHovered)
						admin.controls.appearance.enabled = false;
				}, 500);
			}
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

		this.adminTextLayer = MRE.Actor.Create(this.context,
		{
			actor:
			{
				name: 'adminTextLayer',
				parentId: this.videoPlayerActor.id,
				transform:
				{
					local:
					{
						position: { x: 0, y: 0, z: -0.01 }
					}
				}
			}
		});

		this.createTextActor("ClickText", this.adminTextLayer.id, "Click to enter URL", MRE.Color3.White());
		this.createTextActor("YoutubeCiphered", this.adminTextLayer.id, "This video cannot \n be played due \n to copyright", MRE.Color3.Red());
		this.createTextActor("YoutubeUnplayable", this.adminTextLayer.id, "This video is \n not viewable \n outside of \n Youtube.com", MRE.Color3.Red());
		this.createTextActor("InvalidUrl", this.adminTextLayer.id, "Invalid URL", MRE.Color3.Red());
		this.createTextActor("Load", this.adminTextLayer.id, "Attempting to load", MRE.Color3.White());

		this.adminTextActors["ClickText"].appearance.enabledFor.add('admin');
		this.adminActiveText = "ClickText";
	}

	private async createAdminController(user: MRE.User)
	{
		let admin = this.admins[user.id.toString()];

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

		admin.controls = adminControlsActor;

		await this.assets.loadGltf(`${Server.baseUrl}/videoPlayerControls.glb`);

		this.createButtonActor(admin, "PlayButton", -8);
		this.createButtonActor(admin, "PauseButton", -8, false);
		this.createButtonActor(admin, "StopButton",  -6);
		this.createButtonActor(admin, "RestartButton", -4);
		this.createButtonActor(admin, "LoopButton", 8, false);
		this.createButtonActor(admin, "LoopGreenButton", 8);
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
					materialId: this.iconsMat.id,
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
			if (this.videoPlayerActor)
				this.adminControlsButtonAction(buttonActor, user);
		});
	}

	private createTextActor(name: string, parentId: MRE.Guid, content: string, color: MRE.Color3)
	{
		this.adminTextActors[name] = MRE.Actor.Create(this.context,
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
						position: { x: 0, y: 0, z: 0 }
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

		if (videoInfo.streamingData.adaptiveFormats[0].cipher || 
			videoInfo.streamingData.adaptiveFormats[0].signatureCipher ||
			videoInfo.streamingData.formats[0].cipher ||
			videoInfo.streamingData.formats[0].signatureCipher)
		{
			this.showText("YoutubeCiphered");
			return;
		} 
		
		if (videoInfo.playabilityStatus.status === "UNPLAYABLE")
		{
			this.showText("YoutubeUnplayable");
			return;
		}			
		
		if (videoInfo.videoDetails.isLiveContent)
		{
			this.isLiveStream = true;
		}

		return `youtube://${videoId}`;
	}

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

		let username = await this.scrapeDLive(channel.toLowerCase());

		this.isLiveStream = true;

		return `https://live.prd.dlive.tv/hls/live/${username.toLowerCase()}.m3u8`;
	}

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

		if (!this.videoStream || this.videoStream.uri !== theUrl)
		{
			this.videoStream = this.videos.createVideoStream('videoStream', { uri: theUrl });

			await this.videoStream.created;

			this.videoDuration = this.videoStream.duration * 1000;

			if (theUrl.includes('webm') || theUrl.includes('mp4'))
				this.videoDuration = await getVideoDuration(theUrl) * 1000;
		}
		
		if (this.videoPlayerActor)
		{
			this.videoInstance = this.videoPlayerActor.startVideoStream(this.videoStream.id, options);
			this.videoPlayerActor.appearance.enabled = false;
		}
		
		this.isVideoPlaying = true;

		if (!this.isLiveStream)
		{
			this.startTime = Date.now();
			this.timeRemaining = this.videoDuration;
			this.createTimer();
		}		
		
		this.adminTextActors[this.adminActiveText].appearance.enabledFor.delete('admin');
		this.adminActiveText = "";

		this.changePlayPauseButtonState();
	}

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

	private start()
	{
		this.isVideoPlaying = true;

		this.startTime = Date.now();

		this.createTimer();

		if (this.videoInstance)
		{
			this.videoInstance.resume();
		}

		this.changePlayPauseButtonState();
	}

	private stop()
	{
		this.isVideoPlaying = false;

		clearTimeout(this.videoTimer)

		if (this.videoInstance)
		{
			this.videoInstance.stop();
			this.videoPlayerActor.appearance.enabled = true;
		}

		this.showText("ClickText");

		this.setInitialPlayPauseButtonState();
	}

	private pause()
	{
		this.isVideoPlaying = false;

		clearTimeout(this.videoTimer)
		this.timeRemaining -= Date.now() - this.startTime;

		if (this.videoInstance)
		{
			this.videoInstance.pause();
		}

		this.changePlayPauseButtonState();
	}

	private restart()
	{
		if (this.videoInstance)
		{
			this.videoInstance.setState({ time: 0 });
		}

		this.timeRemaining = this.videoDuration;

		this.createTimer()
	}

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
		if (this.adminActiveText !== type)
		{
			if (this.adminActiveText)
				this.adminTextActors[this.adminActiveText].appearance.enabledFor.delete('admin');
			
			this.adminTextActors[type].appearance.enabledFor.add('admin');
			this.adminActiveText = type;
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

	private async scrapeDLive(channel: string)
	{
		let text = await (await fetch(`https://dlive.tv/${channel}`)).text();

		//Regex from https://github.com/streamlink/streamlink
		let username = text.match(/(?<=user:)(\w|-)+/)[0];

		return username;
	}
}