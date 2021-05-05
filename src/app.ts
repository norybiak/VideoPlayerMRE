import * as MRE from "@microsoft/mixed-reality-extension-sdk";
import {GroupMask} from "@microsoft/mixed-reality-extension-sdk";

const GROUP_ADMIN = 'lucky-admin';

/** Defines an animation control field */
interface ControlDefinition {
	/** Decorative label for the control */
	label: string;
	/** Changes a property, and returns a result string */
	action: (incr: number) => string;
	/** Whether the control should be updated on a timer */
	realtime?: boolean;
	/** The actor who's text needs to be updated */
	labelActor?: MRE.Actor;
}
interface UserMediaInstance {
	user: MRE.User,
	mediaInstance: MRE.MediaInstance,
}

export default class LiveStreamVideoPlayer {

	private userMediaInstanceMap: Record<string, UserMediaInstance>;
	private assets: MRE.AssetContainer;
	private root: MRE.Actor;
	private videoStreams: MRE.VideoStream[];
	private currentStream = 0;
	private isPlaying = true;
	private volume = 0.7;
	private looping = true;
	private spread = 0.1;
	private rolloffStartDistance = 24;
	readonly groupMask: MRE.GroupMask;

	constructor(private context: MRE.Context, private params: MRE.ParameterSet) {
		this.assets = new MRE.AssetContainer(context);
		this.groupMask = new GroupMask(context, [GROUP_ADMIN]);

		console.log("App constructed:", context.sessionId);
		this.context.onStarted(async () => {
			console.log("App started:", context.sessionId);
			this.userMediaInstanceMap = {};
			const videoStream1 = this.assets.createVideoStream(
				'stream1',
				{
					uri: 'http://108.72.45.167:8080/tmp_hls/stream/index.m3u8'
				}
			);

			this.videoStreams = [videoStream1];
			this.root = MRE.Actor.Create(this.context, {actor: {name: 'Root'}});
			this.showControls();
		});

		this.context.onUserJoined((user) => this.handleUserJoined(user));
		this.context.onUserLeft((user: MRE.User) => this.handleUserLeft(user));
		this.context.onStopped(() => {
			Object.values(this.userMediaInstanceMap).forEach(v => v.mediaInstance.stop());
			this.userMediaInstanceMap = {};
			console.log("App stopped", context.sessionId);
		})
	}

	private async handleUserJoined(user: MRE.User) {
		console.log("User Joined:", user.id, user.name);
		await this.init(user);
		if (this.checkUserRole(user, 'moderator')) {
			user.groups.add(GROUP_ADMIN);
		}
	}

	private handleUserLeft(user: MRE.User) {
		console.log("User Left:", user.id, user.name);
		const userMediaInstance = this.userMediaInstanceMap[user.id.toString()];
		if (userMediaInstance) {
			userMediaInstance?.mediaInstance.stop();
			delete this.userMediaInstanceMap[user.id.toString()];
		}
	}

	private showControls() {
		const controls: ControlDefinition[] = [
			{
				label: "Playing", realtime: true, action: incr => {
					if (incr !== 0) {
						if (!this.isPlaying) {
							Object.values(this.userMediaInstanceMap).forEach(v => v.mediaInstance.resume());
							this.isPlaying = true;
						} else {
							Object.values(this.userMediaInstanceMap).forEach(v => v.mediaInstance.pause());
							this.isPlaying = false;
						}
					}
					return this.isPlaying ? 'Yes' : 'No';
				}
			},
			{
				label: "Volume", action: incr => {
					if (incr > 0) {
						this.volume = this.volume >= 1.0 ? 1.0 : this.volume + .1;
					} else if (incr < 0) {
						this.volume = this.volume <= 0.0 ? 0.0 : this.volume - .1;
					}
					Object.values(this.userMediaInstanceMap).forEach(v => v.mediaInstance.setState({volume: this.volume}));
					return Math.floor(this.volume * 100) + "%";
				}
			},
			{
				label: "Spread", action: incr => {
					if (incr > 0) {
						this.spread = this.spread >= 1.0 ? 1.0 : this.spread + .1;
					} else if (incr < 0) {
						this.spread = this.spread <= 0.0 ? 0.0 : this.spread - .1;
					}
					Object.values(this.userMediaInstanceMap).forEach(v => v.mediaInstance.setState({spread: this.spread}));
					return Math.floor(this.spread * 100) + "%";
				}
			},
			{
				label: "Rolloff", action: incr => {
					if (incr > 0) {
						this.rolloffStartDistance += 1;
					} else if (incr < 0) {
						this.rolloffStartDistance -= 1;
					}
					Object.values(this.userMediaInstanceMap).forEach(v => v.mediaInstance.setState({rolloffStartDistance: this.rolloffStartDistance}));
					return this.rolloffStartDistance.toString() + 'm';
				}
			},
		];
		this.createControls(controls, MRE.Actor.Create(this.context, {
			actor: {
				appearance: { enabled: this.groupMask },
				name: 'controlsParent',
				grabbable: true,
				parentId: this.root.id,
				transform: {local: { position: { x: 1.2, y: 1.3, z: -0.05 }}}
			}
		}));

	}

	private async init(user: MRE.User) {
		// const groupMask = new GroupMask(this.context, [user.id.toString()]);
		// user.groups.add(user.id.toString());
		const videoActor = MRE.Actor.Create(this.context, {
			actor: {
				exclusiveToUser: user.id,
				// appearance: { enabled: groupMask },
				parentId: this.root.id,
				name: 'video',
				transform: {
					local: {
						position: {x: 0, y: 0, z: 0},
						scale: {x: 2, y: 2, z: 2},

					}
				},
			}
		});
		await Promise.all([videoActor.created()]);

		this.CreateStreamInstance(videoActor, user);
	}

	private createControls(controls: ControlDefinition[], parent: MRE.Actor) {
		const arrowMesh = this.assets.createCylinderMesh('arrow', 0.005, 0.08, 'z', 3);
		const layout = new MRE.PlanarGridLayout(parent);
		const cw = 0.2, ch = 0.1;
		const arrowScale = 0.40;

		let i = 0;
		const realtimeLabels = [] as ControlDefinition[];
		for (const controlDef of controls) {
			let label: MRE.Actor, more: MRE.Actor, less: MRE.Actor;
			layout.addCell({
				row: i,
				column: 2,
				width: cw,
				height: ch,
				contents: label = MRE.Actor.Create(this.context, {
					actor: {
						name: `${controlDef.label}-label`,
						parentId: parent.id,
						appearance: { enabled: this.groupMask },
						text: {
							contents: `${controlDef.label}: ${controlDef.action(0)}`,
							height: 0.0325,
							anchor: MRE.TextAnchorLocation.MiddleLeft,
							justify: MRE.TextJustify.Left,
							color: MRE.Color3.FromInts(255, 200, 255)
						}
					}
				})
			});
			controlDef.labelActor = label;

			layout.addCell({
				row: i,
				column: 0,
				width: cw / 3,
				height: ch,
				contents: less = MRE.Actor.Create(this.context, {
					actor: {
						name: `${controlDef.label}-less`,
						parentId: parent.id,
						appearance: {meshId: arrowMesh.id, enabled: this.groupMask },
						collider: {geometry: {shape: MRE.ColliderType.Auto}},
						transform: {local: {
							rotation: MRE.Quaternion.FromEulerAngles(0, 0, Math.PI * 1.5),
								scale: {x: arrowScale, y: arrowScale, z: arrowScale},
							}
						}
					}
				})
			});

			layout.addCell({
				row: i,
				column: 1,
				width: cw / 3,
				height: ch,
				contents: more = MRE.Actor.Create(this.context, {
					actor: {
						name: `${controlDef.label}-more`,
						parentId: parent.id,
						appearance: { meshId: arrowMesh.id, enabled: this.groupMask },
						collider: {geometry: {shape: MRE.ColliderType.Auto}},
						transform: {local: {
								rotation: MRE.Quaternion.FromEulerAngles(0, 0, Math.PI * 0.5),
								scale: {x: arrowScale, y: arrowScale, z: arrowScale},
							}
						}
					}
				})
			});

			if (controlDef.realtime) {
				realtimeLabels.push(controlDef)
			}

			less.setBehavior(MRE.ButtonBehavior).onClick(() => {
				label.text.contents = `${controlDef.label}: ${controlDef.action(-1)}`;
				for (const rt of realtimeLabels) {
					rt.labelActor.text.contents = `${rt.label}: ${rt.action(0)}`;
				}
			});
			more.setBehavior(MRE.ButtonBehavior).onClick(() => {
				label.text.contents = `${controlDef.label}: ${controlDef.action(1)}`;
				for (const rt of realtimeLabels) {
					rt.labelActor.text.contents = `${rt.label}: ${rt.action(0)}`;
				}
			});

			i++;
		}
		layout.applyLayout();
	}

	private CreateStreamInstance(parentActor: MRE.Actor, user: MRE.User) {
		if (this.userMediaInstanceMap[user.id.toString()]) {
			this.userMediaInstanceMap[user.id.toString()].mediaInstance.stop();
		}

		const mediaInstance = parentActor.startVideoStream(this.videoStreams[this.currentStream].id,
			{
				volume: this.volume,
				looping: this.looping,
				spread: this.spread,
				rolloffStartDistance: this.rolloffStartDistance
			});
		console.log("Stream Started:", user.id, user.name);
		this.userMediaInstanceMap[user.id.toString()] = { user, mediaInstance };
	}

	private checkUserRole(user: MRE.User, role: string) {
		 return (user.properties['altspacevr-roles'] === role ||
			user.properties['altspacevr-roles'].includes(role));
	}
}
