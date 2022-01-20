import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import { TextFontFamily } from '@microsoft/mixed-reality-extension-sdk';

export type CustomSetVideoStateOptions = MRE.SetVideoStateOptions & { muted: boolean, lastVolume?: number };

export interface UserMediaState {
	mediaInstance: MRE.MediaInstance,
	playing: boolean;
	soundOptions: CustomSetVideoStateOptions,
	user: MRE.User;
	assets: MRE.AssetContainer;
	actors: MRE.Actor[];
	currentStream?: SynchronizedVideoStream;
	videoActor?: MRE.Actor;
	controlActor?: MRE.Actor;
}

export interface UserMediaState2 {
	mediaInstance: MRE.MediaInstance,
	playing: boolean;
	soundOptions: CustomSetVideoStateOptions,
	// user: MRE.User;
	assets: MRE.AssetContainer;
	actors: MRE.Actor[];
}

export interface SynchronizedVideoStream {
	id: string;
	videoStream?: MRE.VideoStream;
	startTime: number;
	streamCount: number;
	duration: string;
	uri: string;
	photoArtifactId: string;
	photoUrl: string;
	sbs: "half" | "full";
	enabled: boolean;
	title: string;
	rollingM3u8ManifestEnabled?: boolean;
}

const headsetDevices = [
	'oculus',
	'reverb',
	'vive',
	'razer',
	'pixmax',
	'valve',
];

/** Defines an animation control field */
export interface ControlDefinition {
	/** Decorative label for the control */
	label: string;
	/** Changes a property, and returns a result string */
	action: (incr: number) => string;
	/** Whether the control should be updated on a timer */
	realtime?: boolean;
	/** The actor who's text needs to be updated */
	labelActor?: MRE.Actor;
	less?: MRE.Actor;
	more?: MRE.Actor;
	toggle?: boolean;
}

const createControls = (parent: MRE.Actor, controls: ControlDefinition[], userMediaSession: UserMediaState) => {
	const { assets, user: { context, id } } = userMediaSession;
	const arrowMesh = assets.createCylinderMesh('arrow', 0.005, 0.08, 'z', 3);
	const material = assets.createMaterial("mat", { color: MRE.Color3.Red() });

	const layout = new MRE.PlanarGridLayout(parent);
	const cw = 0.08, ch = 0.1;
	const arrowScale = 0.60;

	let i = 0;
	// this.realtimeLabels = [] as ControlDefinition[];
	for (const controlDef of controls) {
		let label: MRE.Actor, more: MRE.Actor, less: MRE.Actor;
		layout.addCell({
			row: i,
			column: 0,
			width: cw,
			height: ch,
			contents: label = MRE.Actor.Create(context, {
				actor: {
					name: `${controlDef.label}-label-${id.toString()}`,
					exclusiveToUser: userMediaSession.user.id,
					parentId: parent.id,
					// appearance: { enabled: this.groupMask },
					text: {
						contents: `${controlDef.label}:${controlDef.action(0)}`,
						height: 0.0315,
						font: TextFontFamily.Monospace,
						anchor: MRE.TextAnchorLocation.MiddleRight,
						justify: MRE.TextJustify.Right,
						color: MRE.Color3.Red(),
					}
				}
			})
		});
		controlDef.labelActor = label;

		layout.addCell({
			row: i,
			column: 1,
			width: cw / 1.25,
			height: ch,
			contents: less = MRE.Actor.Create(context, {
				actor: {
					name: `${controlDef.label}-less-${id.toString()}`,
					parentId: parent.id,
					exclusiveToUser: userMediaSession.user.id,
					appearance: {
						meshId: arrowMesh.id,
						materialId: material.id
						// enabled: this.groupMask
					},
					collider: { geometry: { shape: MRE.ColliderType.Auto } },
					transform: {
						local: {
							rotation: MRE.Quaternion.FromEulerAngles(0, 0, Math.PI * 1.5),
							scale: { x: arrowScale, y: arrowScale, z: arrowScale },
						}
					}
				}
			})
		});

		layout.addCell({
			row: i,
			column: 2,
			width: cw / 1.25,
			height: ch,
			contents: more = MRE.Actor.Create(context, {
				actor: {
					name: `${controlDef.label}-more-${id.toString()}`,
					parentId: parent.id,
					exclusiveToUser: userMediaSession.user.id,
					appearance: {
						meshId: arrowMesh.id,
						materialId: material.id
						// enabled: this.groupMask
					},
					collider: { geometry: { shape: MRE.ColliderType.Auto } },
					transform: {
						local: {
							rotation: MRE.Quaternion.FromEulerAngles(0, 0, Math.PI * 0.5),
							scale: { x: arrowScale, y: arrowScale, z: arrowScale },
						}
					}
				}
			})
		});

		// if (controlDef.realtime) {
		// 	this.realtimeLabels.push(controlDef);
		// }
		controlDef.less = less;
		controlDef.more = more;
		if (controlDef.toggle) {
			more.appearance.enabled = false;
			less.appearance.enabled = true;
		}
		i++;
	}
	layout.applyLayout();
};

const attachControls = (controls: ControlDefinition[]) => {
	for (const controlDef of controls) {
		const { less, more, labelActor: label, } = controlDef;
		less.setBehavior(MRE.ButtonBehavior).onClick(() => {
			label.text.contents = `${controlDef.label}:${controlDef.action(-1)}`;
			if (controlDef.toggle) {
				more.appearance.enabled = true;
				less.appearance.enabled = false;
			}
			// for (const rt of this.realtimeLabels) {
			// 	rt.labelActor.text.contents = `${rt.label}: ${rt.action(0)}`;
			// }
		});
		more.setBehavior(MRE.ButtonBehavior).onClick(() => {
			label.text.contents = `${controlDef.label}:${controlDef.action(1)}`;
			if (controlDef.toggle) {
				more.appearance.enabled = false;
				less.appearance.enabled = true;
			}
			// for (const rt of this.realtimeLabels) {
			// 	rt.labelActor.text.contents = `${rt.label}: ${rt.action(0)}`;
			// }
		});
	}
};

const hipsTransform = {
	local: {
		position: { x: .1, y: -0.40, z: 1.6 },
		scale: { x: 1.25, y: 1.25, z: 1.25 },
		rotation: {
			z: 0,
			y: 0,
			x: 10 * MRE.DegreesToRadians,
		},
	}
};

const leftHandTransform = {
	local: {
		position: { x: 0, y: 0.06, z: -0.05 },
		scale: { x: .3, y: .3, z: .3 },
		rotation: {
			z: 35 * MRE.DegreesToRadians,
			y: -45 * MRE.DegreesToRadians,
			x: 35 * MRE.DegreesToRadians,
		},
	}
};


export const showControls = (userMediaSession: UserMediaState) => {
	const { mediaInstance, soundOptions, user } = userMediaSession;
	const controls: ControlDefinition[] = [
		// {
		// 	label: "Playing", realtime: false, action: incr => {
		// 		if (!incr) {
		// 			if (!soundOptions.paused) {
		// 				mediaInstance.resume();
		// 			} else {
		// 				mediaInstance.pause();
		// 			}
		// 		} else if (incr > 0) {
		// 			mediaInstance?.resume()
		// 			userMediaSession.playing = true;
		// 			userMediaSession.soundOptions.paused = false;
		// 		} else {
		// 			mediaInstance?.pause();
		// 			userMediaSession.playing = false;
		// 			userMediaSession.soundOptions.paused = true;
		// 		}
		// 		return userMediaSession.playing ? 'Yes' : 'No';
		// 	}
		// },
		{
			label: "VOLUME", action: incr => {
				if (soundOptions.muted) {
					return Math.round(soundOptions.lastVolume * 100) + "%";
				}
				const vol = Math.round(soundOptions.volume * 100) / 100;
				if (incr > 0) {
					soundOptions.volume = vol >= 1.0 ? 1.0 : vol + (vol < .1 ? 0.02 : 0.05);
				} else if (incr < 0) {
					soundOptions.volume = vol <= 0.0 ? 0.0 : vol - (vol <= .1 ? 0.02 : 0.05);
				}
				mediaInstance?.setState({ volume: soundOptions.volume });
				const val = soundOptions.volume * 100;
				const newVal = Math.round(val);
				return `${newVal < 10 ? '0': ''}`+ newVal + "%";
			}
		},
		{
			toggle: true,
			label: "MUTE", action: incr => {
				if (incr > 0) {
					soundOptions.muted = false;
					soundOptions.volume = soundOptions.lastVolume || 0.7;
					soundOptions.lastVolume = undefined;
				} else if (incr < 0) {
					soundOptions.muted = true;
					soundOptions.lastVolume = soundOptions.volume;
					soundOptions.volume = 0;
				}
				mediaInstance?.setState({ volume: soundOptions.volume });
				return soundOptions.muted ? 'ON' : 'OFF';
			}
		},
		// {
		// 	label: "Spread", action: incr => {
		// 		if (incr > 0) {
		// 			soundOptions.spread = soundOptions.spread >= 1.0 ? 1.0 : soundOptions.spread + .1;
		// 		} else if (incr < 0) {
		// 			soundOptions.spread = soundOptions.spread <= 0.0 ? 0.0 : this.spread - .1;
		// 		}
		// 		// Object.values(this.userMediaInstanceMap).forEach(v => v.mediaInstance.setState({spread: this.spread}));
		// 		this.mediaInstance?.setState({spread: this.spread});
		// 		return Math.floor(this.spread * 100) + "%";
		// 	}
		// },
		// {
		// 	label: "Rolloff", action: incr => {
		// 		if (incr > 0) {
		// 			this.rolloffStartDistance += 1;
		// 		} else if (incr < 0) {
		// 			this.rolloffStartDistance -= 1;
		// 		}
		// 		// Object.values(this.userMediaInstanceMap).forEach(v => v.mediaInstance.setState({rolloffStartDistance: this.rolloffStartDistance}));
		// 		this.mediaInstance?.setState({rolloffStartDistance: this.rolloffStartDistance});
		// 		return this.rolloffStartDistance.toString() + 'm';
		// 	}
		// },
	];

	let headsetDetected = false;
	for (const device of headsetDevices) {
		if (user.properties['device-model'].toLocaleLowerCase().indexOf(device.toLocaleLowerCase()) > -1) {
			headsetDetected = true;
			break;
		}
	}
	// console.log(new Date(), `Detected: ${user.name}`, user.properties);

	const controlActor = MRE.Actor.Create(user.context, {
		actor: {
			exclusiveToUser: user.id,
			name: `controlsParent_${user.id.toString()}`,
			grabbable: true,
			parentId: mediaInstance.actor.id,
			transform: headsetDetected ? leftHandTransform : hipsTransform,
		}
	});
	userMediaSession.actors.push(controlActor);
	userMediaSession.controlActor = controlActor;
	createControls(controlActor, controls, userMediaSession);
	attachControls(controls);
	controlActor.attach(user.id, headsetDetected ? 'left-hand' : 'hips');
};
