import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import {ColliderType} from '@microsoft/mixed-reality-extension-sdk';
import axios from 'axios';
import {CustomSetVideoStateOptions, showControls, SynchronizedVideoStream, UserMediaState} from './controls';
import fetch from 'node-fetch';
import block from "./block";
import createVideoSelection, {playButtonLabel} from "./video-selection";
import theme from './theme';
import delay from "./delay";
import Timeout = NodeJS.Timeout;
import {DialogResponse} from "@microsoft/mixed-reality-extension-sdk/built/user/user";
import {promiseAllTimeout} from "./promiseAllTimeout";
import {retrieveSelectorTransformLocal, saveSelectorTransformLocal} from "./selector-persist-manager";

const getButtonLabel =
    (actor: MRE.Actor) => actor.children.find(v => v.name === playButtonLabel);

const whitelist = [
    'The Duke', 'Jam Rock Girl',
];
const qualifiedPlayers = [
    'yxDuke-red',
    'yxDuke-blue',
]

const hmsToSecondsOnly = (str = '') => {
    var p = str.split(':'),
        s = 0, m = 1;

    while (p.length > 0) {
        s += m * parseInt(p.pop(), 10);
        m *= 60;
    }
    return s;
}

type VideoStreamSelection = {
    syncVideoStream: SynchronizedVideoStream,
    videoStreamCard: MRE.Actor,
    playButton: MRE.Actor,
};

const fetchSyncStreams = (): Promise<Record<string, SynchronizedVideoStream>> => {
    const url = process.env.VIDEO_DATA_URL;
    return fetch(url).then(res => res.json()).then(v => {
        const newResult: Record<string, SynchronizedVideoStream> = {};
        for(const key of Object.keys(v)) {
            if (v[key]?.enabled || (process.env.TEST_MODE && v[key]?.testMode)) {
                newResult[key] = v[key];
            }
        }
        return newResult;
    });
};

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
    private playing = false;
    private streamCount = 0;
    private ignoreClicks = false;
    private vidSelectionTransform: MRE.ActorTransform;
    private startingRollingM3m8Manifest = false;
    private rolloffStartDistance = 20;
    private videoStreamSelections: {
        root: MRE.Actor, videoStreamCardsMapping: Record<string, VideoStreamSelection>
    };
    // private type: 'live' | 'file' = "file";
    private mode: 'normal' | 'sbs'= "normal";

    constructor(private context: MRE.Context, private params: MRE.ParameterSet) {
        this.assets = new MRE.AssetContainer(context);
        console.log(new Date(), "App constructed:", context.sessionId, params);
        if (params?.attach) {
            this.attach = true;
        }
        this.mode = (params?.mode as 'normal' | 'sbs') || (process.env.mode as 'normal' | 'sbs')  || 'normal';
        console.log(new Date(), 'MODE', this.mode);
        this.context.onStarted(async () => {
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
            this.rolloffStartDistance = parseInt(params?.roff as string, 10) || 20;
            // Removed so we start always in the same place
            // if (this.currentStream) {
            //     const vstream = this.videoStreams[this.currentStream];
            //     console.log(new Date(), 'Playing default stream', vstream);
            //     vstream.videoStream = this.assets.createVideoStream(
            //         this.currentStream,
            //         {
            //             // Compute Video Stream
            //             uri: this.videoStreams[this.currentStream].uri,
            //             duration: 99999999,
            //         }
            //     );
            // } else {
            //     throw Error("Video Stream data not loaded")
            // }
            this.root = MRE.Actor.Create(this.context, {actor: {name: 'bigscreen-Root'}});
            await delay(2000);
            this.videoStreamSelections = await createVideoSelection(this.context, this.root, this.assets, this.videoStreams);
            this.videoStreamSelections.root.actorChanged()
            const {root: vidStreamsRoot} = this.videoStreamSelections;
            vidStreamsRoot.grabbable = params?.grab?.toLocaleString() === 'y' || false;
            vidStreamsRoot.onGrab("begin", (user, actionData) => {
                this.vidSelectionTransform = vidStreamsRoot.transform;
            })

            vidStreamsRoot.onGrab("end", (user, actionData) => {
                if(user.properties['altspacevr-roles'].includes('moderator')) {
                    this.vidSelectionTransform = vidStreamsRoot.transform;
                } else {
                    vidStreamsRoot.transform = this.vidSelectionTransform;
                }
            })

            const {position, scale, rotation } = vidStreamsRoot.transform.local;
            const vidDeckTransform = await retrieveSelectorTransformLocal(this.context);
            const selectionSize = params?.sz as string || '1';
            const vidStreamScaleFactor = 0.25 * parseFloat(selectionSize);
            if (vidDeckTransform) {
                vidStreamsRoot.transform = vidDeckTransform;
            } else {
                position.y = 0.11;
                position.z = -2.055;
                this.vidSelectionTransform = vidStreamsRoot.transform;
            }
            scale.x = vidStreamScaleFactor;
            scale.y = vidStreamScaleFactor;
            scale.z = vidStreamScaleFactor;
            await delay(2000);
            vidStreamsRoot.appearance.enabled = true;
            this.initialized = true;
        });

        this.context.onUserJoined((user) => this.handleUserJoined(user));
        this.context.onUserLeft((user: MRE.User) => this.handleUserLeft(user));
        this.context.onStopped(() => {
            Object.values(this.userMediaInstanceMap).forEach(v => v.mediaInstance.stop());
            this.userMediaInstanceMap = {};
            clearTimeout(this.currentStreamTimer);
            saveSelectorTransformLocal(this.context, this.vidSelectionTransform);
            console.log(new Date(), "App stopped", context.sessionId);
        })
    }

    private findUser(userName: string): UserMediaState {
        if (userName) {
            for (const aUser of Object.values(this.userMediaInstanceMap)) {
                if (aUser?.user?.name === userName) {
                    return aUser;
                }
            }
        }
        return null;
    }

    private async handleUserJoined(user: MRE.User) {
        await block(() => this.initialized, 15000);
        console.log(
            new Date(),
            "User Joined:", user.id, user.name,
            "Device:", user.properties['device-model'],
            'Roles:', user.properties['altspacevr-roles'] || 'none');
        await this.init(user);
        this.attachPlayButtonBehaviors();
    }

    private cleanupUser(user: MRE.User) {
        const userMediaInstance = this.userMediaInstanceMap[user.id.toString()];
        if (userMediaInstance) {
            userMediaInstance?.mediaInstance.stop();
            this.streamCount > 0 && this.streamCount--;
            userMediaInstance?.actors.forEach(v => {
                try {
                    v.detach()
                } catch (error) {
                    // We do not care
                }
                try {
                    v.appearance.enabled = false
                } catch (error) {
                    // We do not care
                }
                console.log(new Date(), "Number of Streams", this.streamCount);
            });
            this.userMediaInstanceMap[user.id.toString()] = undefined;
            delete this.userMediaInstanceMap[user.id.toString()];
        }
    }

    private handleUserLeft(user: MRE.User) {
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
                resourceId: `artifact:${process.env.SBS_CAMERA_ARTIFACT_ID}`,
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
                            position: {x: 0.000, y: 0, z: 0.02},
                            rotation, //: { y: -100, z: 0, x: 0 }
                        }
                    },
                }
            });
            // await sbsActor.created();
        }
        this.CreateStreamInstance(videoActor, user);
    }

    // TODO: Refactor
    private async stopAllMediaInstanceVideoStreams() {
        console.log(new Date(), "Stopping All Media Instances")
//        await this.stopRollingM3m8Manifest();
        for (const userMediaInstance of Object.values(this.userMediaInstanceMap)) {
            userMediaInstance.mediaInstance.stop()
            console.log(new Date(), "Stopped Video Stream for", userMediaInstance.user.name);
            if (userMediaInstance?.currentStream) {
                this.streamCount > 0 && this.streamCount--;
                userMediaInstance.currentStream.startTime = -1
                console.log(new Date(), "Number of Streams", this.streamCount);

            }
        }
        this.playing = false;
    }

    private startAllMediaInstanceVideoStreams() {
        console.log(new Date(), "Starting All Media Instances")
        for (const userMediaInstance of Object.values(this.userMediaInstanceMap)) {
            try {
                userMediaInstance.controlActor?.destroy();
            } catch (error) {
                console.log(new Date(), "testing control actor");
            }
            userMediaInstance.controlActor = null;
            this.CreateStreamInstance(userMediaInstance.videoActor, userMediaInstance.user, false);

        }
    }

    private getStreamUrl(videoStream: SynchronizedVideoStream): MRE.VideoStream {
        let uri = videoStream.uri;
        if (videoStream.rollingM3u8ManifestEnabled) {
            uri = `${process.env.ROLLING_M3M8_MANIFEST_URL}/roll/${this.currentStream}/${this.getSessionId()}/index.m3u8`;
            console.log("Horace", uri)
        }
        return this.assets.createVideoStream(
            this.currentStream,
            {
                uri,
            }
        );;
    }
    private async CreateStreamInstance(parentActor: MRE.Actor, user: MRE.User, ignoreControls = false) {
        // if (this.userMediaInstanceMap[user.id.toString()]) {
        // 	this.userMediaInstanceMap[user.id.toString()].mediaInstance.stop();
        // }
        const aVideoStream = this.videoStreams[this.currentStream];
        if (!aVideoStream.videoStream) {
            this.streamCount = 0;
            aVideoStream.startTime = aVideoStream.startTime && aVideoStream.startTime > 0 ? aVideoStream.startTime : -1;
            aVideoStream.videoStream = this.getStreamUrl(aVideoStream);
        }
        const soundOptions: CustomSetVideoStateOptions = {
            volume: 1,
            spread: 0.0,
            rolloffStartDistance: this.rolloffStartDistance,
            muted: false,
        }
        const getRunningTime = () => Math.round(Date.now() - aVideoStream.startTime) / 1000;
        // Block here if anyone is starting remote Stream
        if (aVideoStream.rollingM3u8ManifestEnabled) {
            await block( () => !this.startingRollingM3m8Manifest);
        }
        if (aVideoStream?.startTime > 0) {
            soundOptions.time = getRunningTime();
        } else {
            // First one to start Stream, in
            aVideoStream.startTime = Date.now();
            if (aVideoStream.rollingM3u8ManifestEnabled) {
                // We need to start rolling
                this.startingRollingM3m8Manifest = true;
                const rollingManifestUrl = `${process.env.ROLLING_M3M8_MANIFEST_URL}/start/${this.currentStream}`;
                try {
                    const response = await axios.get(rollingManifestUrl, { headers: {
                            'x-mre-session': this.getSessionId()
                        }});
                }  catch (err) {
                    console.error("Could not start rolling m3u8", this.currentStream, err.message);
                    return; // Do not process any further so
                } finally {
                    this.startingRollingM3m8Manifest = false;
                }
            }
            this.streamCount = 0;
            this.playing = true;
            this.currentStreamTimer = setTimeout(() => {
                    this.stopAllMediaInstanceVideoStreams();
                    // this.startAllMediaInstanceVideoStreams();
                },
                hmsToSecondsOnly(aVideoStream.duration) * 1000);
        }
        this.streamCount++;
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
        console.log(new Date(), "Number of Streams", this.streamCount);
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

    protected attachPlayButtonBehaviors = () => {
        console.log(new Date(), "Attaching PlayButtons")
        for (const {
            syncVideoStream,
            playButton
        } of Object.values(this.videoStreamSelections?.videoStreamCardsMapping)) {
            try {
                const label = getButtonLabel(playButton);
                const {disable, default: defaultColor, hover} = theme.color.button;
                const buttonBehavior = playButton.setBehavior(MRE.ButtonBehavior);
                if (syncVideoStream.id === this.currentStream) {
                    label.text.contents = "ACTIVE";
                    playButton.appearance.material.color = MRE.Color4.FromColor3(disable.background);
                } else {
                    label.text.contents = 'Play'
                    playButton.appearance.material.color = MRE.Color4.FromColor3(defaultColor.background);
                }
                // buttonBehavior.onHover("enter", ((user, actionData) => {
                //     playButton.appearance.material.color = MRE.Color4.FromColor3(hover.background);
                //     label.text.color = hover.text;
                // }));
                // buttonBehavior.onHover("exit", ((user, actionData) => {
                //     playButton.appearance.material.color =
                //         MRE.Color4.FromColor3(this.currentStream !== syncVideoStream.id ? defaultColor.background : disable.background);
                //     label.text.color = this.currentStream !== syncVideoStream.id ?
                //         defaultColor.text : disable.text;
                // }));
                buttonBehavior.onClick(async (user, actionData) => {
                    // TODO:  Check to see if video stopped or one player in room
                    if (this.currentStream !== syncVideoStream.id  && !this.ignoreClicks) {
                        const canChangeVideo = await this.handleChangeUserRequest(user, syncVideoStream.id);
                        if (!canChangeVideo) {
                            return;
                        }

                        label.text.contents = "ACTIVE";
                        playButton.appearance.material.color = MRE.Color4.FromColor3(disable.background);
                        // Find the other button
                        const {playButton: currentPlayButton} = this.videoStreamSelections?.videoStreamCardsMapping[this.currentStream]
                        if (playButton) {
                            const currentLabel = getButtonLabel(currentPlayButton);
                            currentLabel.text.contents = 'Play';
                            currentPlayButton.appearance.material.color = MRE.Color4.FromColor3(defaultColor.background);
                        }
                        await this.stopRollingM3m8Manifest();
                        this.currentStream = syncVideoStream.id;
                        clearTimeout(this.currentStreamTimer);
                        this.stopAllMediaInstanceVideoStreams();
                        this.startAllMediaInstanceVideoStreams();
                    }
                });
            } catch (error) {
                console.error("Error attaching behaviors for", syncVideoStream);
            }
        }
    };

    // If moderator, change movie
    // Disable clicks after use makes a selection for n seconds
// Iterate through all current viewers (do not worry recent joiners", add to mapping, and prompt user.  Do not prompt autobot
// Generate promises, and iterate through the results
// if any result is false, do not change, prevent user from clicking button again.
// if yes change movie

    private async handleChangeUserRequest(user: MRE.User, newVidStreamId: string) {
        if (this.playing
            && this.streamCount - (!!this.findUser('BlueAutobot') ? 1 : 0) > 1
            && !user.properties['altspacevr-roles'].includes('moderator')) {
            const confirmation = await user.prompt("Please wait 15 seconds for the current viewers to approve your movie change request.  Press 'OK' to continue, 'Cancel' to abort.");
            if (!confirmation?.submitted) return false;
            const votingResults: Promise<DialogResponse>[]= [];
            const videoStream = this.videoStreams[newVidStreamId];
            for(const aUser of this.context.users) {
                if (aUser.name !== process.env.AUTO_BOT && user.id !== aUser.id) {
                    votingResults.push(aUser.prompt(`${user.name} wants to watch ${videoStream.title}.\n\nPress 'OK' to accept the change, 'Cancel' to continue watching the current movie.` ));
                }
            }
            this.ignoreClicks = true;
            try {
                const results = await promiseAllTimeout(votingResults, 15000) as DialogResponse[];
                for(const result of results) {
                    console.log(new Date(), "Voting Result", result);
                    if (result && typeof result.submitted === 'boolean' &&  !result .submitted) {
                        console.log(new Date(), `Change request by ${user.name} rejected.`);
                        user.prompt("Your change request was rejected.\n\nPlease respect your fellow viewers' desire to continue watching the movie.");
                        return false;
                    }
                }
                const finalConfirmation = await user.prompt("Your change request was approved.\n\nPress 'OK' to continue, 'Cancel' to abort.");
                if (!finalConfirmation?.submitted) {
                    return false
                }
            } catch (error) {
                console.error(error);
                return false;
            } finally {
                this.ignoreClicks = false;
            }
        }
        return true;
    }
    private getSessionId() { return  new Buffer(this.context.sessionId).toString('base64') ; }

    private async stopRollingM3m8Manifest() {
        if (this.videoStreams[this.currentStream].rollingM3u8ManifestEnabled) {
            const rollingManifestUrl = `${process.env.ROLLING_M3M8_MANIFEST_URL}/stop/${this.currentStream}`;
            try {
                const response = await axios.get(rollingManifestUrl, {
                    headers: {
                        'x-mre-session': this.getSessionId()
                    }
                });
                console.log(new Date(), response.data);
            } catch (err) {
                console.error("Could not stop rolling m3u8", err);
            } finally {
                this.startingRollingM3m8Manifest = false;
            }
        }
    }

}
