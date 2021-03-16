import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import { Resources } from '../core/UI';
import { Element, ElementOptions } from '../core/element';
import merge from 'deepmerge';

/** @internal */
export class Icon extends Element {

    constructor(icon: string, context: MRE.Context, defaultActorLike: Partial<MRE.ActorLike>, resources: Resources, options?: ElementOptions) {

        super();

        let refinedActorLike = this._refineActorLike(icon, resources, defaultActorLike, options);

        this._name = options.name;

        let actorLike = merge(defaultActorLike, refinedActorLike);
        
        this.createActor(context, actorLike);

    }
    
    private _refineActorLike(icon: string, resources: Resources, defaultActorLike: Partial<MRE.ActorLike>, options?: ElementOptions) {

        let meshId: MRE.Guid;
        let materialId: MRE.Guid = resources.defaultMaterial.id;

        if (options.material !== undefined) {
            materialId = options.material.id;
        }
        
        meshId = resources.iconPack.find(m => m.name === icon).id;

        let appearanceLike: Partial<MRE.AppearanceLike> = {
            meshId: meshId,
            materialId: materialId,
        };        
        
        //Note: This is here because my icons are need to be force 90 degrees. TODO: Fix planes.
        let rotation = (options.rotation !== undefined) ? options.rotation : MRE.Quaternion.FromEulerAngles(-90 * MRE.DegreesToRadians, 0, 0);
        let transformLike: Partial<MRE.ActorTransformLike> = {
            local: {
                rotation
            }
        };
    
        let colliderLike: Partial<MRE.ColliderLike> = {
            geometry: { shape: MRE.ColliderType.Auto }
        };
    
        return {
            transform: transformLike ,
            appearance: appearanceLike ,
            collider: colliderLike,
        };
    
    }

}