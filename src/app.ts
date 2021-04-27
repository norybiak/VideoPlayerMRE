import * as MRE from "@microsoft/mixed-reality-extension-sdk";

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

export default class VideoPlayer {

	private assets: MRE.AssetContainer;
	private videos: MRE.AssetContainer;
	private root: MRE.Actor;
	private parentActor: MRE.Actor;
	private videoStreams: MRE.VideoStream[];
	private currentInstance: MRE.MediaInstance;
	private currentStream = 0;
	private isPlaying = true;
	private volume = 1.0;
	private looping = true;
	private spread = 0.0;
	private rolloffStartDistance = 30;
	private UIReady: Promise<void>;

	constructor(private context: MRE.Context, private params: MRE.ParameterSet) {
		this.videos = new MRE.AssetContainer(context);
		this.assets = new MRE.AssetContainer(context);
		console.log("App constructed")
		this.context.onStarted(async () => {
			console.log("App started");
			this.UIReady = this.init();
		});

		this.context.onUserJoined((user) => this.handleUser(user));
		this.context.onStopped(() => {
			if (this.currentInstance) {
				this.currentInstance.stop();
				this.isPlaying = false;
				this.currentInstance = null;
			}
			console.log("App stopped");
		})
	}

	private async handleUser(user: MRE.User) {
		if (this.checkUserRole(user, 'moderator')) {
			await this.UIReady;
			this.showControls(user);
		}
	}

	private showControls(user?: MRE.User) {
		const controls: ControlDefinition[] = [
			{
				label: "Playing", realtime: true, action: incr => {
					if (incr !== 0) {
						if (!this.isPlaying) {
							if (!this.currentInstance) {
								this.CreateStreamInstance();
							}
							this.currentInstance.resume();
							this.isPlaying = true;
						} else {
							this.currentInstance.stop();
							this.currentInstance = null;
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
					this.currentInstance.setState({volume: this.volume});
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
					this.currentInstance.setState({spread: this.spread});
					return Math.floor(this.spread * 100) + "%";
				}
			},
			{
				label: "Rolloff Distance", action: incr => {
					if (incr > 0) {
						this.rolloffStartDistance += 1;
					} else if (incr < 0) {
						this.rolloffStartDistance -= 1;
					}
					this.currentInstance.setState({rolloffStartDistance: this.rolloffStartDistance});
					return this.rolloffStartDistance.toString() + 'm';
				}
			},
		];

		this.createControls(controls, MRE.Actor.Create(this.context, {
			actor: {
				exclusiveToUser: user.id,
				name: 'controlsParent',
				parentId: this.root.id,
				transform: {local: {position: { x: 1.2, y: -0.375, z: -0.05 }}}
			}
		}));

	}

	private async init() {
		this.root = MRE.Actor.Create(this.context, {actor: {name: 'Root'}});
		this.parentActor = MRE.Actor.Create(this.context, {
			actor: {
				parentId: this.root.id,
				name: 'video',
				transform: {
					local: {
						position: {x: 0, y: 0, z: 0},
						scale: {x: 2, y: 2, z: 2}
					}
				},
			}
		});

		const videoStream1 = this.assets.createVideoStream(
			'stream1',
			{
				uri: 'http://108.72.45.167:8080/tmp_hls/stream/index.m3u8'
//				uri: `youtube://5yx6BWlEVcY`
			}
		);

		//Todo: More video sources and types for when support is patched in.
		// Non youtube?

		this.videoStreams = [videoStream1];

		await Promise.all([this.parentActor.created()]);

		this.CreateStreamInstance();
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
						appearance: {meshId: arrowMesh.id},
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
						appearance: {meshId: arrowMesh.id},
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

	private CreateStreamInstance() {
		if (this.currentInstance) {
			this.currentInstance.stop();
			this.currentInstance = null;
		}
		this.currentInstance = this.parentActor.startVideoStream(this.videoStreams[this.currentStream].id,
			{
				volume: this.volume,
				looping: this.looping,
				spread: this.spread,
				rolloffStartDistance: this.rolloffStartDistance
			});

	}

	private checkUserRole(user: MRE.User, role: string) {
		 return (user.properties['altspacevr-roles'] === role ||
			user.properties['altspacevr-roles'].includes(role));
	}
}