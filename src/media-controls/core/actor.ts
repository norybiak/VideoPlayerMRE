import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import { ColliderType } from '@microsoft/mixed-reality-extension-sdk';

export interface IActor {

    readonly name: string,
    readonly id: MRE.Guid
    actor: MRE.Actor,
    show(): void,
    hide(): void
    toggleVisibility(): void,
    enableCollider(): void,
    disableCollider(): void,
    toggleCollider(): void,
    addBehavior(action: string, handler?: MRE.ActionHandler<MRE.ButtonEventData>): this

}

/** @internal */
export abstract class Actor implements IActor {

    public get id() { return this._id };
    public get actor() { return this._actor; };
    public get name() { return this._name; };

    protected _id: MRE.Guid;
    protected _behavior: MRE.ButtonBehavior;

    protected constructor(protected _name: string, protected _actor: MRE.Actor) {

        this._id = MRE.newGuid();

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

        this._actor.collider.enabled = true;

    }

    public disableCollider() {

        this._actor.collider.enabled = false;

    }

    public toggleCollider() {

        this._actor.collider.enabled = !this._actor.collider.enabled;

    }

    public addBehavior(action: string, handler?: MRE.ActionHandler<MRE.ButtonEventData>) {

        if (!this._behavior) {
            if (!this._actor.collider) {
                this._actor.setCollider(ColliderType.Auto, false);
            }

            if (!this._actor.appearance.enabled) {
                this._actor.collider.enabled = false;
            }

            this._behavior = this._actor.setBehavior(MRE.ButtonBehavior);
        }

        this._addBehavior(action, handler);

        return this;

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
}
