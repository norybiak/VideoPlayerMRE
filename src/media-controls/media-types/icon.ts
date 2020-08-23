import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import { Actor, IActor } from '../';

export interface MediaIcon extends IActor {

    readonly behavior: MRE.ButtonBehavior,
    addBehavior(action: string, handler?: MRE.ActionHandler<MRE.ButtonEventData>): this

}

/** @internal */
export class Icon extends Actor implements MediaIcon {

    public get name() { return this._name; };
    public get actor() { return this._actor; };
    public get behavior() { return this._behavior; };

    constructor(name: string, actor: MRE.Actor) {

        super(name, actor);

    }

}
