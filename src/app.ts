import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import Server from './server';

import URL from 'url';
import fetch from 'node-fetch';

const VIDEO_PLAYER_WIDTH = 1;
const VIDEO_PLAYER_HEIGHT = 1 / (16/9);
const BUTTON_SCALE = 0.03;

/**
 * The main class of this app. All the logic goes here.
 */
export default class App
{
	private assets: MRE.AssetContainer;
	private videos: MRE.AssetContainer;

	private videoPlayerActor: MRE.Actor;
	private isVideoPlayerHovered: boolean = false;

	private playerControls: MRE.Actor;
	private playerControlButtons: { [key: string]: MRE.Actor } = {};
	private isPlayerControlsHovered: boolean = false;

	private video: MRE.VideoStream;
	private videoInstance: MRE.MediaInstance;
	private isVideoPlaying: boolean;
	private loop: boolean = false;
	
	private clickText: MRE.Actor;
	private errorText: MRE.Actor;

	private adminGroup: MRE.GroupMask;
	private userGroup: MRE.GroupMask;

	constructor(private context: MRE.Context, private baseUrl: string, private params: MRE.ParameterSet)
	{
		this.videos = new MRE.AssetContainer(context);
		this.assets = new MRE.AssetContainer(context);

		this.adminGroup = new MRE.GroupMask(this.context, ['admin']);
		this.userGroup = new MRE.GroupMask(this.context, ['user']);

		this.context.onStarted(() => this.start());
		this.context.onUserJoined((user) => this.handleUser(user));  
	}

	/**
	 * Once the context is "started", initialize the app.
	 */
	private async start()
	{
		this.createVideoPlayerActor();
		this.createVideoPlayerBehavior();
		this.createVideoPlayerAdminButtons();
	}

	private handleUser(user: MRE.User)
	{
		if (this.checkUserRole(user, 'moderator'))
		{
			user.groups.add('admin');
		}
		else
		{
			user.groups.add('default');
		}
	}

	private createVideoPlayerActor()
	{
		this.videoPlayerActor = MRE.Actor.Create(this.context, 
		{
			actor: 
			{
				name: 'videoPlayerActor',
				appearance: 
				{
					meshId: this.assets.createBoxMesh('box', VIDEO_PLAYER_WIDTH, VIDEO_PLAYER_HEIGHT, 0.0001).id,
					materialId: this.assets.createMaterial('material', { color: MRE.Color3.Black() }).id
				},
				collider: 
				{ 
					geometry: { shape: MRE.ColliderType.Auto}
				}
			}
		});
	}

	private async createVideoPlayerBehavior()
	{
		const behavior = this.videoPlayerActor.setBehavior(MRE.ButtonBehavior);

		behavior.onHover('enter', (user) =>
		{
			if (this.checkUserRole(user, 'moderator'))
			{            
				this.isVideoPlayerHovered = true;
				this.playerControlsEnabled(true);
			}
		});

		behavior.onHover('exit', (user) =>
		{
			if (this.checkUserRole(user, 'moderator'))
			{  
				this.isVideoPlayerHovered = false;

				//Hack to check if player controls are hovered.
				setTimeout(() =>
				{
					if (!this.isPlayerControlsHovered && !this.isVideoPlayerHovered)
						this.playerControlsEnabled(false);
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
						this.parseUrl(dialog.text).then((parsedUrl) =>
						{
							this.clickText.appearance.enabledFor.delete('admin');
							this.createOrUpdateVideoPlayer(parsedUrl);
						});
					}
				});
			}
		});

		this.clickText = MRE.Actor.Create(this.context, 
		{
			actor: 
			{
				name: 'clickText',
				parentId: this.videoPlayerActor.id,
				appearance:
				{
					enabled: this.adminGroup
				},
				text:
				{
					contents: "Click to enter URL",
					height: 0.1,
					anchor: MRE.TextAnchorLocation.MiddleCenter,
					color: MRE.Color3.White()
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

		this.errorText = MRE.Actor.Create(this.context, 
		{
			actor: 
			{
				name: 'errorText',
				parentId: this.videoPlayerActor.id,
				appearance: { enabled: false },
				text:
				{
					contents: "Youtube \n video cannot be \n played",
					height: 0.1,
					anchor: MRE.TextAnchorLocation.MiddleCenter,
					color: MRE.Color3.Red(),
					justify: MRE.TextJustify.Center
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

	private async createVideoPlayerAdminButtons()
	{
		this.playerControls = MRE.Actor.Create(this.context, 
		{
			actor: 
			{
				name: "playerControls",
				appearance: { enabled: false },
				transform: { local: { position: { x: 0, y: -(VIDEO_PLAYER_HEIGHT/2) + 1/20, z: -0.01 } } }
			}
		});

		const sharedMat = this.assets.createMaterial('ControlsMaterial', 
		{
			mainTextureId: this.assets.createTexture('icons', { uri: `${Server.baseUrl}/icons.png` }).id,
			emissiveColor: MRE.Color3.White(),
			alphaMode: MRE.AlphaMode.Blend
		});

		await this.assets.loadGltf(`${Server.baseUrl}/videoPlayerControls.glb`);

		this.createButtonActor("PlayButton", -8, sharedMat);
		this.createButtonActor("PauseButton", -8, sharedMat, false);
		this.createButtonActor("StopButton",  -6, sharedMat);
		this.createButtonActor("RestartButton", -4, sharedMat);

		//Looping is currently broken
		//this.createButtonActor("LoopButton", 8, sharedMat, false);
		//this.createButtonActor("LoopOffButton", 8, sharedMat);

		this.setInitialPlayPauseButtonState();
	}

	private createButtonActor(theName: string, xOffset: number, sharedMat: MRE.Material, isEnabled: boolean = true)
	{
		const actor = MRE.Actor.Create(this.context,
		{
			actor:
			{
				name: theName,
				parentId: this.playerControls.id,
				appearance:
				{
					meshId: this.assets.meshes.find(m => m.name === theName).id,
					materialId: sharedMat.id,
					enabled: isEnabled
				},
				collider: { geometry: { shape: MRE.ColliderType.Box } },
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

		this.playerControlButtons[actor.name] = actor;

		let behavior = actor.setBehavior(MRE.ButtonBehavior);
		behavior.onHover('enter', () =>
		{
			this.isPlayerControlsHovered = true;
		});

		behavior.onHover('exit', () =>
		{
			this.isPlayerControlsHovered = false;
		});

		behavior.onButton('released', (user) =>
		{
			if (this.videoInstance)
				this.playerControlButtonAction(actor.name, user);
		});
	}

	private async parseUrl(url: string)
	{
		let parsedUrl = URL.parse(url, true);
		let videoUrl = "";

		videoUrl = parsedUrl.href;

		if (parsedUrl.hostname.includes('youtube'))
		{ 
			videoUrl = await this.handleYoutube(parsedUrl);
		}
		else if (parsedUrl.hostname.includes('mixer'))
		{
			videoUrl = await this.handleMixer(parsedUrl);
		}
	
		//Twitch is not implemented client side yet
		//else if (parsedUrl.hostname.includes('twitch'))
			//theUri = `twitch://${parsedUrl.href}`;
		
		else
		{
			videoUrl = parsedUrl.href;
		}

		return videoUrl;
	}

	private async handleYoutube(theUrl: URL.UrlWithParsedQuery)
	{
		let videoId = theUrl.query.v as string;

		const response = await fetch(`https://www.youtube.com/get_video_info?video_id=${videoId}`);
		const info = await response.text();

		let videoInfo = JSON.parse(unescape(info).match(/(?<=player_response=)[^&]+/)[0]);

		if (videoInfo.playabilityStatus.status !== "UNPLAYABLE")
		{
			if (!videoInfo.streamingData.adaptiveFormats[0].cipher &&
				!videoInfo.streamingData.adaptiveFormats[0].signatureCipher || 
				videoInfo.videoDetails.isLiveContent)
			{
				return `youtube://${videoId}`;
			}
		}

		return;
	}

	private async handleMixer(theUrl: URL.UrlWithParsedQuery)
	{
		let vod = theUrl.query.vod as string;

		const response = await fetch(`https://mixer.com/api/v1/recordings/${vod}`);
		const info: any = await response.json();

		if (info.vods)
		{
			for (let dataType of info.vods)
			{
				if (dataType.format === "raw")
				{
					let vodBaseUrl = dataType.baseUrl;

					return `${vodBaseUrl}/source.mp4`;
				}
			}
		}

		return `mixer://${theUrl.href}`;
	}

	private createOrUpdateVideoPlayer(theUrl: string)
	{
		if (!theUrl)
		{
			this.videoPlayerActor.appearance.enabled = true;
			this.errorText.appearance.enabledFor.add('admin');
			return;
		}

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
		}

		this.videoInstance = this.videoPlayerActor.startVideoStream(this.video.id, options);
		
		this.isVideoPlaying = true;

		this.changePlayPauseButtonState();

		this.videoPlayerActor.appearance.enabled = false;
		this.errorText.appearance.enabledFor.delete('admin');
	}
	
	private playerControlButtonAction(type: string, user?: MRE.User)
	{
		switch (type)
		{
			case 'PlayButton':
			{
				this.isVideoPlaying = true;
				this.videoInstance.resume();

				this.changePlayPauseButtonState();
				break;
			}

			case 'PauseButton':
			{
				this.isVideoPlaying = false;
				this.videoInstance.pause();

				this.changePlayPauseButtonState();
				break;
			}

			case 'StopButton':
			{
				this.stop()

				break;
			}

			case 'RestartButton':
			{
				this.videoInstance.setState({ time: 0 });

				break;
			}

		/*  Looping is currently broken
			case 'LoopButton':
			case 'LoopOffButton':
			{
				this.loop = !this.loop;
				this.videoInstance.setState({looping: this.loop});

				this.changeLoopButtonState();

				break;
			}
		*/

			default:
				break;
		}
	}

	private stop()
	{
		this.isVideoPlaying = false;

		if (this.videoInstance)
			this.videoInstance.stop();

		this.videoPlayerActor.appearance.enabled = true;
		this.clickText.appearance.enabledFor.add('admin');

		this.setInitialPlayPauseButtonState();
	}

	private setInitialPlayPauseButtonState()
	{
		this.playerControlButtons["PlayButton"].appearance.enabled = true;
		this.playerControlButtons["PlayButton"].collider.enabled = true;

		this.playerControlButtons["PauseButton"].appearance.enabled = false;
		this.playerControlButtons["PauseButton"].collider.enabled = false;
	}

	private changePlayPauseButtonState()
	{
		this.playerControlButtons["PauseButton"].appearance.enabled = !this.playerControlButtons["PauseButton"].appearance.enabled
		this.playerControlButtons["PauseButton"].collider.enabled = !this.playerControlButtons["PauseButton"].collider.enabled;

		this.playerControlButtons["PlayButton"].appearance.enabled = !this.playerControlButtons["PlayButton"].appearance.enabled;
		this.playerControlButtons["PlayButton"].collider.enabled = !this.playerControlButtons["PlayButton"].collider.enabled;
	}

/* Looping is broken
	private changeLoopButtonState()
	{
		this.playerControlButtons["LoopButton"].appearance.enabled = !this.playerControlButtons["LoopButton"].appearance.enabled
		this.playerControlButtons["LoopButton"].collider.enabled = !this.playerControlButtons["LoopButton"].collider.enabled;

		this.playerControlButtons["LoopGreenButton"].appearance.enabled = !this.playerControlButtons["LoopGreenButton"].appearance.enabled
		this.playerControlButtons["LoopGreenButton"].collider.enabled = !this.playerControlButtons["LoopGreenButton"].collider.enabled;
	}
*/

	private playerControlsEnabled(state: boolean)
	{
		if (state === true)
		{
		   this.playerControls.appearance.enabledFor.add('admin');
		} 
		else if (state === false)
		{
			this.playerControls.appearance.enabledFor.delete('admin');
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
}