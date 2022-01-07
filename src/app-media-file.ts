import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import {ColliderType} from '@microsoft/mixed-reality-extension-sdk';
import {CustomSetVideoStateOptions, showControls, SynchronizedVideoStream, UserMediaState} from './controls';
import fetch from 'node-fetch';
import block from "./block";
import Timeout = NodeJS.Timeout;

const whitelist = [
    'The Duke', 'Jam Rock Girl',
];
const qualifiedPlayers = [
    'yxDuke-red',
    'yxDuke-blue',
]
const sbsArtifactId = '1902749595545371635';

const hmsToSecondsOnly = (str = '') => {
    var p = str.split(':'),
        s = 0, m = 1;

    while (p.length > 0) {
        s += m * parseInt(p.pop(), 10);
        m *= 60;
    }

    return s;
}

const fetchSyncStreams = (): Promise<Record<string, SynchronizedVideoStream>> => {
    const url = "https://3d-sbs-videos.s3.amazonaws.com/3d-sbs-streams.json"; // TODO: config
    return fetch(url).then(res => res.json())
}

export default class LiveStreamVideoPlayer {

    private userMediaInstanceMap: Record<string, UserMediaState>;
    private readonly assets: MRE.AssetContainer;
    private root: MRE.Actor;
    private videoStreams: Record<string, SynchronizedVideoStream> = {};
    private currentStream = 'stream1';
    private modeNoNewJoins = false;
    private attach = false;
    private initialized = false;
    private currentStreamTimer: Timeout;
    // private type: 'live' | 'file' = "file";
    private mode: 'normal' | 'sbs' = "normal";

    constructor(private context: MRE.Context, private params: MRE.ParameterSet) {
        this.assets = new MRE.AssetContainer(context);
        console.log(new Date(), "App constructed:", context.sessionId, params);
        if (params?.attach) {
            this.attach = true;
        }
        this.mode = (params?.mode as 'normal' | 'sbs') || 'normal';
        console.log('MODE', this.mode);
        if (!this.isClientValid()) {
            return;
        }
        this.context.onStarted(async () => {
            if (!this.isClientValid()) {
                return;
            }
            console.log(new Date(), "App started:", context.sessionId);
            this.userMediaInstanceMap = {};
            // Load data file, and then default stream
            this.videoStreams = await fetchSyncStreams();
            console.log(new Date(), "Loaded Video Stream data", this.videoStreams);
            if (params?.vc || params?.fc) {
                this.currentStream = params.vc as string || params.fc as string;
            } else {
                this.currentStream = Object.keys(this.videoStreams)?.[0];
            }
            if (this.currentStream) {
                const vstream = this.videoStreams[this.currentStream];
                console.log(new Date(), 'Playing default stream', vstream);
                vstream.videoStream = this.assets.createVideoStream(
                    this.currentStream,
                    {
                        uri: this.videoStreams[this.currentStream].uri,
                    }
                );
            } else {
                throw Error("Video Stream data not loaded")
            }
            this.root = MRE.Actor.Create(this.context, {actor: {name: 'bigscreen-Root'}});
            this.initialized = true;
        });

        this.context.onUserJoined((user) => this.handleUserJoined(user));
        this.context.onUserLeft((user: MRE.User) => this.handleUserLeft(user));
        this.context.onStopped(() => {
            Object.values(this.userMediaInstanceMap).forEach(v => v.mediaInstance.stop());
            this.userMediaInstanceMap = {};
            clearTimeout(this.currentStreamTimer);
            console.log(new Date(), "App stopped", context.sessionId);
        })
    }

    private isClientValid() {
        for (const player of qualifiedPlayers) {
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
        await block(() => this.initialized);
        if (!this.isClientValid()) {
            return;
        }
        console.log(
            new Date(),
            "User Joined:", user.id, user.name,
            "Device:", user.properties['device-model'],
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
        await this.init(user);
    }

    private cleanupUser(user: MRE.User) {
        const userMediaInstance = this.userMediaInstanceMap[user.id.toString()];
        if (userMediaInstance) {
            userMediaInstance?.mediaInstance.stop();
            userMediaInstance?.currentStream?.streamCount > 0 && userMediaInstance.currentStream.streamCount--;
            userMediaInstance?.actors.forEach(v => {
				try {
					v.detach()
				} catch (error) {
					// We do not care
				}
				try {

				} catch (error) {
					// We do not care
					v.appearance.enabled = false
				}
			});
            this.userMediaInstanceMap[user.id.toString()] = undefined;
            delete this.userMediaInstanceMap[user.id.toString()];
        }
    }

    private handleUserLeft(user: MRE.User) {
        if (!this.isClientValid()) {
            return;
        }
        console.log(new Date(), "User Left:", user.id, user.name);
        this.cleanupUser(user);
    }

    private async init(user: MRE.User) {
        const streamScale = this.mode === 'sbs' ? 1 : 1;
        const transform = {
            local: {
                position: {x: 0, y: 0, z: 0},
                scale: {x: streamScale, y: streamScale, z: streamScale},
                rotation: {x: 0, y: 0, z: 0},
            }
        }
        if (this.attach) {
            const scaleFactor = 0.85;
            transform.local.position.z = 1;
            transform.local.position.y = 0.25;
            transform.local.scale = {x: scaleFactor, y: scaleFactor, z: scaleFactor};
        }
        const videoActor = MRE.Actor.Create(this.context, {
            actor: {
                exclusiveToUser: user.id,
                // appearance: { enabled: groupMask },
                parentId: this.root.id,
                name: `big-screen-video-${user.id.toString()}`,
                // light: { type: 'point', intensity: 2.5, range: 50, enabled: true, spotAngle: 180, color: MRE.Color3.White() }, // Add a light component.
                transform,
                // rigidBody: this.attach ? { isKinematic: true } : undefined,
                collider: this.attach ? {bounciness: 10, geometry: {shape: ColliderType.Auto}} : undefined,
            }
        });
        await Promise.all([videoActor.created()]);
        if (this.attach) {
            videoActor.attach(user.id, 'center-eye');
        }
        if (this.mode === "sbs") {
            console.log(new Date(), "Creating SBS", this.mode)
            const rotation = MRE.Quaternion.FromEulerAngles(0, -Math.PI, 0);
            const sbsScale = 0.05620;
            // const sbsScale = 0.06;
            const sbsActor = MRE.Actor.CreateFromLibrary(this.context, {
                resourceId: `artifact:${sbsArtifactId}`,
                actor: {
                    parentId: videoActor.id,
                    name: `test-sbs-${user.id}`,
                    exclusiveToUser: user.id,
                    appearance: {enabled: true,},
                    // grabbable: true,
                    collider: {geometry: {shape: MRE.ColliderType.Auto},},
                    transform: {
                        ...transform,
                        local: {
                            ...transform.local,
                            scale: {z: sbsScale, x: sbsScale, y: sbsScale},
                            position: {x: 0.000, y: 0, z: 0.04},
                            rotation, //: { y: -100, z: 0, x: 0 }
                        }
                    },
                }
            });
            await sbsActor.created();
        }
        this.CreateStreamInstance(videoActor, user);
    }

    // TODO: Refactor
    private stopAllMediaInstanceVideoStreams() {
        console.log(new Date(), "Stopping All Media Instances")
        for (const userMediaInstance of Object.values(this.userMediaInstanceMap)) {
            userMediaInstance.mediaInstance.stop()
            console.log(new Date(), "Stopped Video Stream for", userMediaInstance.user.name);
            if (userMediaInstance?.currentStream) {
                userMediaInstance?.currentStream?.streamCount > 0 && userMediaInstance.currentStream.streamCount--;
                userMediaInstance.currentStream.startTime = -1
            }
        }
    }

    private startAllMediaInstanceVideoStreams() {
        console.log(new Date(), "Starting All Media Instances")
        for (const userMediaInstance of Object.values(this.userMediaInstanceMap)) {
            try {
                userMediaInstance.controlActor?.destroy();
            } catch(error) {
                console.log(new Date(), "testing control actor");
            }
            userMediaInstance.controlActor = null;
            this.CreateStreamInstance(userMediaInstance.videoActor, userMediaInstance.user, false);

        }
    }

    private CreateStreamInstance(parentActor: MRE.Actor, user: MRE.User, ignoreControls = false) {
        // if (this.userMediaInstanceMap[user.id.toString()]) {
        // 	this.userMediaInstanceMap[user.id.toString()].mediaInstance.stop();
        // }
        const aVideoStream = this.videoStreams[this.currentStream];
        if (!aVideoStream.videoStream) {
            aVideoStream.streamCount = 0;
            aVideoStream.startTime = aVideoStream.startTime && aVideoStream.startTime > 0 ? aVideoStream.startTime : -1;
            aVideoStream.videoStream = this.assets.createVideoStream(
                this.currentStream,
                {
                    uri: aVideoStream.uri,
                }
            );
        }
        const soundOptions: CustomSetVideoStateOptions = {
            volume: 0.7,
            spread: 0.0,
            rolloffStartDistance: 24,
            muted: false,
        }
        const getRunningTime = () => Math.round(Date.now() - aVideoStream.startTime) / 1000;
        if (aVideoStream?.startTime > 0) {
            soundOptions.time = getRunningTime();
        } else {
            aVideoStream.startTime = Date.now();
            this.currentStreamTimer = setTimeout(() => {
                    this.stopAllMediaInstanceVideoStreams();
                    this.startAllMediaInstanceVideoStreams();
                },
                hmsToSecondsOnly(aVideoStream.duration) * 1000);
        }
        aVideoStream.streamCount++;
        const mediaInstance = parentActor.startVideoStream(aVideoStream?.videoStream?.id, soundOptions);
        console.log(new Date(), "Stream Started:", user.id, user.name, this.currentStream);

        const userMediaState: UserMediaState = {
            user,
            mediaInstance,
            playing: true,
            assets: this.assets,
            soundOptions,
            actors: [parentActor],
            currentStream: aVideoStream,
            videoActor: parentActor,
        }
        this.userMediaInstanceMap[user.id.toString()] = userMediaState;
        this.mode !== 'sbs' && showControls(userMediaState);
    }

    private canViewPlayer(user: MRE.User, role: string) {
        const moderator = (user.properties['altspacevr-roles'] === role ||
            user.properties['altspacevr-roles'].includes(role));

        if (this.modeNoNewJoins) {
            return whitelist.includes(user.name);
        }
        if (moderator) {
            console.log(new Date(), `Detected moderator: ${user.name}`, user.properties);
            return whitelist.includes(user.name);
        }
        return true;
    }
}
