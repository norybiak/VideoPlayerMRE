import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import { Group, GroupOptions } from './group';

interface UIOptions {
    scale: number
}

export interface Resources {
    iconPack: MRE.Asset[],
    defaultMaterial: MRE.Material,
    definition?: {}
}

/** @internal */
export class UI {

    public get context() { return this._context; };
    public get resources() { return this._resources; };
    public get definitions() { return this._definitions };
    public get ready() { return this._ready; };
    public get groups() { return [...this._groups.values()] };

    private _context: MRE.Context;
    private _assets: MRE.AssetContainer;

    private _scale: number;
    private _resources: Resources;
    private _definitions: {};

    private _ready: boolean = false;

    private _groups = new Map<string, Group>();

    constructor(context: MRE.Context, options?: UIOptions) {

        this._context = context;

        this._scale = options.scale || 1;

        this._assets = new MRE.AssetContainer(context);

    }

    public async loadIconPack(path: string) {

        const defaultMaterial = this._assets.createMaterial('defaultMaterial', {
            mainTextureId: this._assets.createTexture('icons', { uri: `${path}/icons.png` }).id,
            emissiveColor: MRE.Color3.White(),
            alphaMode: MRE.AlphaMode.Blend
        });

        const iconPack = await this._assets.loadGltf(`${path}/planes.glb`, 'mesh');

        this._resources = { 
            iconPack: iconPack,
            defaultMaterial: defaultMaterial
        };

        this._ready = true;

    }

    public createGroup(name: string, options?: GroupOptions) {

        if (this._groups.has(name)) {

            let total = this._getTotalOfEntries(name);

            if (total > 0) {
                name += total.toString();
            }
        }

        options.groupScale = (options.groupScale !== undefined) ? options.groupScale : this._scale;

        let group = new Group(this._context, this._resources, options);
        this._groups.set(name, group);

        return group;

    }

    private _getTotalOfEntries(name: string) {

        let total = 0;

        if (this._groups.size > 0) {
            this._groups.forEach((value, key) => {
                if (key.includes(name))
                    total++;
            });
        }

        return total;

    }

}
