import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import { Icon, Label } from '../elements';
import { Actor, ActorOptions } from './actor';

export type ElementTypes = Icon | Label;

export interface ElementOptions extends ActorOptions { }

/** @internal */
export abstract class Element extends Actor {

    public get name() { return this._name; };
    public get actor() { return this._actor; };
    public get behavior() { return this._behavior; };
    protected _name: string;

    protected constructor() {

        super();

    }

    protected createActor(_context: MRE.Context, refinedActorLike: Partial<MRE.ActorLike>) {

        this._actor = MRE.Actor.Create(_context, { actor: refinedActorLike });

    }

    public created() {

        return this._actor.created();

    }

}