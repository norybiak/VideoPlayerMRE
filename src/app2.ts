import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import { ColliderType } from '@microsoft/mixed-reality-extension-sdk';
import block from './block';
import { CustomSetVideoStateOptions, showControls, UserMediaState, UserMediaState2 } from './controls';

const whitelist = [
	'The Duke', 'J@mRock_Girl', 'Artsy!'
];
const qualifiedPlayers = [
	'yxDuke-red',
	'yxDuke-blue',
]
export default class LiveStreamVideoPlayer {

	private userMediaState: UserMediaState2;
	private readonly assets: MRE.AssetContainer;
	private root: MRE.Actor;
	private videoStreams: MRE.VideoStream[];
	private currentStream = 0;
	private modeNoNewJoins = false;
	private attach = false;
	private appStarted = false;
	private videoActor: MRE.Actor;

	constructor(private context: MRE.Context, private params: MRE.ParameterSet) {
		this.assets = new MRE.AssetContainer(context);
		console.log(new Date(), "App constructed:", context.sessionId, params);
		if (params?.attach) {
			this.attach = true;
		}
		if (!this.isClientValid()) { return; }
		this.context.onStarted(async () => {
			if (!this.isClientValid()) { return; }
			console.log(new Date(), "App starting:", context.sessionId);
			this.userMediaState = null;
			const videoStream1 = this.assets.createVideoStream(
				'stream1',
				{
					// uri: 'http://108.72.45.167:8080/tmp_dash/stream/index.mpd',
					uri: 'http://108.72.45.167:8080/hls/stream/index.m3u8',
					// uri: 'http://service-stitcher.clusters.pluto.tv/stitch/hls/channel/569546031a619b8f07ce6e25/master.m3u8?advertisingId=&appName=web&appVersion=unknown&appStoreUrl=&architecture=&buildVersion=&clientTime=0&deviceDNT=0&deviceId=2aaaf380-c2a0-11eb-b95a-9564040e8ac6&deviceMake=Chrome&deviceModel=web&deviceType=web&deviceVersion=unknown&includeExtendedEvents=false&sid=2a276526-cf0b-433e-b553-654032d0c7a8&userId=&serverSideAds=true&yyy=index.m3u8',
					duration: 0,
				}
			);

			this.videoStreams = [videoStream1];
			this.root = MRE.Actor.Create(this.context, {actor: {name: 'bigscreen-Root'}});
			await this.root.created;
			await this.init();
			console.log(new Date(), "App started:", context.sessionId);
		});

		this.context.onUserJoined((user) => this.handleUserJoined(user));
		this.context.onUserLeft((user: MRE.User) => this.handleUserLeft(user));
		this.context.onStopped(() => {
			this.userMediaState?.mediaInstance.stop();
			this.root?.destroy()
			this.userMediaState = null;
			this.appStarted = false;
			console.log(new Date(), "App stopped", context.sessionId);
		})
	}

	private isClientValid() {
		for(const player of qualifiedPlayers) {
			if (this.context.sessionId.indexOf(player) !== -1) {
				return true;
			}
		}
		if (!qualifiedPlayers.includes(this.context.sessionId)) {
			console.log(new Date(), "Rejected unknown player", this.context.sessionId);
			return false;
		}
		return false;
	}

	private async handleUserJoined(user: MRE.User) {
		await block(() => this.appStarted, 30000);
		if (!this.isClientValid()) { return; }
		console.log(
			new Date(),
			"User Joined:", user.id, user.name,
			"Device:",  user.properties['device-model'],
			'Roles:', user.properties['altspacevr-roles'] || 'none');
		if (!this.canViewPlayer(user, 'moderator')) {
			this.modeNoNewJoins = true;
			console.log(new Date(), `User ${user.name} blocked`);
			return;
		}
		if (!this.canViewPlayer(user, 'helper')) {
			// this.modeNoNewJoins = true;
			console.log(new Date(), `User ${user.name} blocked`);
			return;
		}
		this.CreateStreamInstance(this.videoActor);

	}

	private handleUserLeft(user: MRE.User) {
		if (!this.isClientValid()) { return; }
		console.log(new Date(), "User Left:", user.id, user.name);
		// const userMediaInstance = this.userMediaInstanceMap[0];
		// if (userMediaInstance) {
		// 	userMediaInstance?.mediaInstance.stop();
		// 	userMediaInstance?.actors.forEach(v => v.detach());
		// 	userMediaInstance?.actors.forEach(v => v.appearance.enabled = false);
		// 	this.userMediaInstanceMap[0] = undefined;
		// 	delete this.userMediaInstanceMap[0];
		// }
	}

	private getVideoActor = () => {
		const transform = {
			local: {
				position: { x: 0, y: 0, z: 0 },
				scale: { x: 2, y: 2, z: 2 },
			}
		}
		// if (this.attach) {
		// 	const scaleFactor = 0.85;
		// 	transform.local.position.z = 1;
		// 	transform.local.position.y = 0.25;
		// 	transform.local.scale = { x: scaleFactor, y: scaleFactor, z: scaleFactor};
		// }
		return MRE.Actor.Create(this.context, {
			actor: {
				// exclusiveToUser: user.id,
				// appearance: { enabled: groupMask },
				parentId: this.root.id,
				name: `big-screen-video-0`,
				// light: { type: 'point', intensity: 2.5, range: 50, enabled: true, spotAngle: 180, color: MRE.Color3.White() }, // Add a light component.
				transform,
				// rigidBody: this.attach ? { isKinematic: true } : undefined,
				collider: this.attach ? { bounciness: 10, geometry: { shape: ColliderType.Auto } } : undefined,
			}
		});

	}

	private async init() {
		if (!this.appStarted) {
			const videoActor = this.getVideoActor();
			await Promise.all([videoActor.created()]);
			this.videoActor = videoActor;
			// if (this.attach) {
			// 	videoActor.attach(user.id, 'center-eye');
			// }
			this.appStarted = true;
		}
	}

	private CreateStreamInstance(parentActor: MRE.Actor) {
		// this.userMediaState?.mediaInstance?.stop();
		const soundOptions: CustomSetVideoStateOptions = {
			volume: 0.7,
			looping: false,
			spread: 0.0,
			rolloffStartDistance: 24,
			muted: false,
		}
		const mediaInstance = parentActor.startVideoStream(this.videoStreams[this.currentStream].id, soundOptions);
		console.log(new Date(), "Stream Started:");
		const userMediaState: UserMediaState2 = {
			// user,
			mediaInstance,
			playing: true,
			assets: this.assets,
			soundOptions,
			actors: [],
		}
		this.userMediaState = userMediaState;
		// showControls(userMediaState);
	}

	private canViewPlayer(user: MRE.User, role: string) {
		const moderator =  (user.properties['altspacevr-roles'] === role ||
			user.properties['altspacevr-roles'].includes(role));

		if (this.modeNoNewJoins) {
			return whitelist.includes(user.name);
		}
		if (moderator) {
			// console.log(new Date(), `Detected moderator: ${user.name}`, user.properties);
			return whitelist.includes(user.name) ;
		}
		return true;
	}
}
