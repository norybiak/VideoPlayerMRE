import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import Server from './server';

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
export default class App
{
	private assets: MRE.AssetContainer;
	private videos: MRE.AssetContainer;

	private videoPlayer: MRE.Actor;

	private admins: { [key: string]: Admins } = {};

	private video: MRE.VideoStream;
	private videoInstance: MRE.MediaInstance;

	private isVideoPlaying: boolean;
	private loop: boolean = false;

	private videoPlayerMat: MRE.Material;
	private iconMat: MRE.Material;

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
		this.iconMat = this.assets.createMaterial('ControlsMaterial',
		{
			mainTextureId: this.assets.createTexture('icons', { uri: `${Server.baseUrl}/icons.png` }).id,
			emissiveColor: MRE.Color3.White(),
			alphaMode: MRE.AlphaMode.Blend
		});

		this.videoPlayerMat = this.assets.createMaterial('material', { color: MRE.Color3.Black() });
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
				collider:
				{
					geometry: { shape: MRE.ColliderType.Auto}
				}
			}
		});

		this.createText(adminVideoPlayerActor.id);

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

		const admin = this.admins[user.id.toString()];
		admin.videoPlayer = adminVideoPlayerActor;
		admin.controls = adminControlsActor;

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
						this.parseUrl(dialog.text).then((parsedUrl) =>
						{
							admin.videoPlayer.findChildrenByName('ClickText', false)[0].appearance.enabled = false;

							if (!parsedUrl)
							{
								admin.videoPlayer.findChildrenByName('ErrorText', false)[0].appearance.enabled = true;
							}
							else
							{
								this.createOrUpdateVideoPlayer(parsedUrl);
							}
						});
					}
				});
			}
		});

		await this.assets.loadGltf(`${Server.baseUrl}/videoPlayerControls.glb`);

		this.createButtonActor(admin, "PlayButton", -8);
		this.createButtonActor(admin, "PauseButton", -8, false);
		this.createButtonActor(admin, "StopButton",  -6);
		this.createButtonActor(admin, "RestartButton", -4);

		//Looping is currently broken
		//this.createButtonActor("LoopButton", 8, sharedMat, false);
		//this.createButtonActor("LoopOffButton", 8, sharedMat);
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

	private createText(parentId: MRE.Guid)
	{
		MRE.Actor.Create(this.context,
		{
			actor:
			{
				name: 'ClickText',
				parentId: parentId,
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

		MRE.Actor.Create(this.context,
		{
			actor:
			{
				name: 'ErrorText',
				parentId: parentId,
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

		if (this.videoPlayer)
		{
			this.videoInstance = this.videoPlayer.startVideoStream(this.video.id, options);
			this.videoPlayer.appearance.enabledFor.delete('default');
		}

		for (let admin in this.admins)
		{
			this.admins[admin].videoInstance = this.admins[admin].videoPlayer.startVideoStream(this.video.id, options);
			this.admins[admin].videoPlayer.appearance.enabled = false;
			this.admins[admin].videoPlayer.findChildrenByName('ErrorText', false)[0].appearance.enabled = false;
		}

		this.isVideoPlaying = true;

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
				if (this.isVideoPlaying)
				{
					this.videoInstance.setState({ time: 0 });

					for (let admin in this.admins)
					{
						this.admins[admin].videoInstance.setState({ time: 0 });
					}
				}

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

	private start()
	{
		this.isVideoPlaying = true;

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

	private stop()
	{
		this.isVideoPlaying = false;

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
			this.admins[admin].videoPlayer.findChildrenByName('ClickText', false)[0].appearance.enabled = true;
		}

		this.setInitialPlayPauseButtonState();
	}

	private pause()
	{
		this.isVideoPlaying = false;

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

/* Looping is broken
	private changeLoopButtonState()
	{
		this.playerControlButtons["LoopButton"].appearance.enabled = !this.playerControlButtons["LoopButton"].appearance.enabled
		this.playerControlButtons["LoopButton"].collider.enabled = !this.playerControlButtons["LoopButton"].collider.enabled;

		this.playerControlButtons["LoopGreenButton"].appearance.enabled = !this.playerControlButtons["LoopGreenButton"].appearance.enabled
		this.playerControlButtons["LoopGreenButton"].collider.enabled = !this.playerControlButtons["LoopGreenButton"].collider.enabled;
	}
*/

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