import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import { Actor } from './actor';
import { Icon, Label } from '..';

export enum IconType {

    Play = 'PlayIcon',
    Pause = 'PauseIcon',
    Restart = 'RestartIcon',
    Stop = 'StopIcon',
    Next = 'NextIcon',
    LoopOn = 'LoopOnIcon',
    LoopOff = 'LoopOffIcon',
    Previous = 'PreviousIcon',
    NextPage = 'NextPageIcon',
    PreviousPage = 'PreviousPageIcon',
    Config = 'ConfigIcon',
    Settings = 'SettingsIcon',
    Volume = 'VolumeIcon',
    Mute = "MuteIcon",
    Playlist = 'PlaylistIcon',
    Slider = 'SliderLineIcon',
    SliderPuck = "SliderHandleIcon"

}

interface IContainer {

    readonly icons: Icon[],
    readonly labels: Label[],
    readonly actor: MRE.Actor,
    loadGltf(): Promise<void>,
    createIcon(type: IconType, options?: any): Icon,
    createLabel(): Label,
    getIcon(name: string): Icon,
    getLabel(name: string): Label,
    setGroup(group: string): void,
    removeGroup(group: string): void,

}

interface Options {

    gltf?: string,
    iconScale?: number,
    labelScale?: number,
    actor?: Partial<MRE.ActorLike>

}

const BUTTON_SCALE = 0.03;

export class Container extends Actor implements IContainer {

    public get icons() { return [...this._icons.values()]; }
    public get labels() { return [...this._labels.values()]; }
    public get actor() { return this._actor; }

    private _icons: Map<string, Icon>;
    private _labels: Map<string, Label>;

    private _iconAssets: MRE.Asset[];
    private _material: MRE.Material;

    private _ready: boolean = false;

    private _iconScale: number;
    private _labelScale: number;

    constructor(private context: MRE.Context, private assets: MRE.AssetContainer, private baseUrl: string, options?: Options) {

        super(options.actor.name, null);

        this._actor = MRE.Actor.Create(this.context, {
            actor: options.actor
        });

        this._iconScale = options.iconScale || 1;
        this._labelScale = options.labelScale || 1;

        this._icons = new Map<string, Icon>();
        this._labels = new Map<string, Label>();

    }

    public async loadGltf(gltf?: string, png?: string) {

        let gltfPath = gltf || `${this.baseUrl}/MediaIcons.glb`;
        let pngPath = png || `${this.baseUrl}/icons2.png`;

        this._material = this.assets.createMaterial('ControlsMaterial', {
            mainTextureId: this.assets.createTexture('icons', { uri: pngPath }).id,
            emissiveColor: MRE.Color3.White(),
            alphaMode: MRE.AlphaMode.Blend
        });

        this._iconAssets = await this.assets.loadGltf(gltfPath, 'mesh');
        this._ready = true;

    }

    public createIcon(type: IconType, options?: Partial<MRE.ActorLike>): Icon {

        if (!this._ready) {
            console.log("Cannot create icon! Please load a valid glTF first.")
        }

        let name = options.name || type;

        if (this._icons.has(name)) {

            let total = this._getTotalOfEntries(name);

            if (total > 0) {
                name += total.toString();
            }
        }

        let actor = this._createActor(name, type, options);

        if (actor.appearance.enabled === false) {
            actor.collider.enabled = true;
        }

        let icon = new Icon(name, actor);
        this._icons.set(name, icon);

        return icon;

    }

    public createLabel(content: string = "", options?: Partial<MRE.ActorLike>): Label {

        let name = options.name;

        if (this._icons.has(name)) {
            let total = this._getTotalOfEntries(name);

            if (total > 0) {
                name += total.toString();
            }
        }

        let actor = this._createLabel(name, content, options);

        let label = new Label(name, actor);
        this._labels.set(name, label);

        return label;
    }

    public getIcon(name: string) {

        if (!this._icons.has(name)) {
            console.log(`Icon [${ name }] doesn't exist! Did you set a name?`);
        }

        return this._icons.get(name);
    }

    public getLabel(name: string) {

        if (!this._labels.has(name)) {
            console.log(`Label [${ name }] doesn't exist! Did you set a name?`);
        }

        return this._labels.get(name);

    }

    public setGroup(group: string) {

        this._actor.appearance.enabledFor.add(group);

    }

    public removeGroup(group: string) {

        this._actor.appearance.enabledFor.delete(group);

    }

    private _createActor(name: string, type: IconType, options?: Partial<MRE.ActorLike>) {

        let appearance: Partial<MRE.AppearanceLike> = {
            ...options.appearance,
            meshId: this._iconAssets.find(m => m.name === type).id,
            materialId: this._material.id
        }

        let collider: Partial<MRE.ColliderLike> = {
            ...options.collider,
            geometry: { shape: MRE.ColliderType.Auto },
            enabled: true
        };

        let transform: Partial<MRE.ActorTransformLike> = {
            ...options.transform,
            local: {
                rotation: MRE.Quaternion.FromEulerAngles(-90 * MRE.DegreesToRadians, 0, 0),
                scale: { x: this._iconScale, y: this._iconScale, z: this._iconScale },
                ...((options.transform !== undefined) && options.transform.local),
            }
        }

        let actor = {
            parentId: this._actor.id,
            ...options,
            appearance: { ...appearance },
            collider: { ...collider },
            transform: { ...transform },
            name: name
        }

        return MRE.Actor.Create(this.context, { actor: actor });

    }

    private _createLabel(name: string, content: string, options?: Partial<MRE.ActorLike>) {

        let text: Partial<MRE.TextLike> = {
            height: 1,
            anchor: MRE.TextAnchorLocation.MiddleCenter,
            justify: MRE.TextJustify.Center,
            color: MRE.Color3.White(),
            ...options.text,
            contents: content,
        }

        let transform: Partial<MRE.ActorTransformLike> = {
            ...options.transform,
            local: {
                scale: { x: this._labelScale, y: this._labelScale, z: this._labelScale },
                ...((options.transform !== undefined) && options.transform.local),
            }
        }

        let actor = {
            parentId: this._actor.id,
            ...options,
            text: { ...text },
            transform: { ...transform },
            name: name
        }

        return MRE.Actor.Create(this.context, { actor: actor });

    }

    private _getTotalOfEntries(name: string) {

        console.log(name);

        let total = 0;

        if (this._icons.size > 0) {
            this._icons.forEach((value, key) => {
                console.log(key);
                if (key.includes(name))
                    total++;
            });
        }

        return total;

    }
}
