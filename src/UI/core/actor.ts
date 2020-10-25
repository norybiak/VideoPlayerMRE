import * as MRE from '@microsoft/mixed-reality-extension-sdk';

export interface ActorOptions {

    name?: string,
    position?: Partial<MRE.Vector3Like>,
    scale?: MRE.Vector3Like,
    rotation?: MRE.Quaternion,
    height?: number,
    anchor?: MRE.TextAnchorLocation,
    justify?: MRE.TextJustify,
    color?: MRE.Color3,
    enabled?: boolean,
    mask?: MRE.GroupMask,
    material?: MRE.Material,
    mesh?: MRE.Mesh,
    parentId?: MRE.Guid,
    actor?: Partial<MRE.ActorLike>,

}

/** @internal */
export abstract class Actor {

    protected _actor: MRE.Actor;
    protected _behavior: MRE.ButtonBehavior;

    protected constructor() {

    }

    public show() {

        this._actor.appearance.enabled = true;

    }

    public hide() {

        this._actor.appearance.enabled = false;

    }

    public toggleVisibility() {

        this._actor.appearance.enabled = !this._actor.appearance.enabled;

    }

    public enableCollider() {

        if ( this._actor.collider) {
            this._actor.collider.enabled = true;
        }

        this._searchChildrenOfActor(this._actor.children, (child) => {
            if (child.collider) {
                child.collider.enabled = true;
            }         
        });

    }

    public disableCollider() {

        if (this._actor.collider) {
            this._actor.collider.enabled = false;
        }

        this._searchChildrenOfActor(this._actor.children, (child) => {
            if (child.collider) {
                child.collider.enabled = false;
            }
        });

    }

    public toggleCollider() {

        if (this._actor.collider) {
            this._actor.collider.enabled = !this._actor.collider.enabled;
        }

        this._searchChildrenOfActor(this._actor.children, (child) => {
            if (child.collider) {
                child.collider.enabled = !child.collider.enabled ;
            }
        });

    }

    public addBehavior(action: string, handler?: MRE.ActionHandler<MRE.ButtonEventData>) {

        if (!this._behavior) {
            if (!this._actor.collider) {
                this._actor.setCollider(MRE.ColliderType.Auto, false);
            }

            if (this._actor.parent && typeof this._actor.parent.appearance.enabled === "boolean") {
                if (this._actor.parent.appearance.enabled === false) {
                    this._actor.collider.enabled = false;
                }
            }

            this._behavior = this._actor.setBehavior(MRE.ButtonBehavior);
        }

        this._addBehavior(action, handler);

        return this;

    }

    public static _defaultActorLike(options?: ActorOptions) {

        let position = (options.position !== undefined) ? options.position : { x: 0, y: 0, z: 0 };
        let rotation = (options.rotation !== undefined) ? options.rotation : MRE.Quaternion.Zero();
        let scale = (options.scale !== undefined) ? options.scale : { x: 1, y: 1, z: 1 };
        let mask = (options.mask !== undefined) ? options.mask : true;
        let enabled = (options.enabled !== undefined) ? options.enabled : mask;
        let parentId = (options.parentId !== undefined) ? options.parentId : MRE.ZeroGuid;
        let actor = (options.actor !== undefined) ? options.actor : {};

        let appearanceLike: Partial<MRE.AppearanceLike> = {
            enabled,
            ...((actor.appearance !== undefined) && actor.appearance)
        }

        let transformLike: Partial<MRE.ActorTransformLike> = {
            local: {
                position,
                rotation,
                scale
            },
            ...((actor.transform !== undefined) && actor.transform)
        }

        return {
            name: options.name,
            parentId: parentId,
            appearance: appearanceLike,
            transform: transformLike,
            ...actor
        };

    }

    private _addBehavior(action: string, handler?: MRE.ActionHandler<MRE.ButtonEventData>) {

        switch (action) {
            case 'pressed':
            case 'holding':
            case 'released':
                this._behavior.onButton(action, handler);
                break;

            case 'enter':
            case 'hovering':
            case 'exit':
                this._behavior.onHover(action, handler);
                break;

            case 'click':
                this._behavior.onClick(handler);
                break;

            default:
                break;
        }

    }

    private _searchChildrenOfActor(children: MRE.Actor[], handler: (child: MRE.Actor) => void) {

		children.forEach((child) => {
			if (child.children.length > 0) {
				this._searchChildrenOfActor(child.children, handler);
			}

            handler(child);
        });
        
    }
    
}
