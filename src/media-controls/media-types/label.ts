import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import { Actor, IActor } from '../';

export interface MediaLabel extends IActor {

    set(content: string): void,
    clear(): void

}

/** @internal */
export class Label extends Actor implements MediaLabel {

    public get name() { return this._name; };
    public get actor() { return this._actor; };

    constructor(name: string, actor: MRE.Actor) {

        super(name, actor);

    }

    public set(content: string) {

        this._actor.text.contents = content;

    }

    public clear() {

        this._actor.text.contents = "";

    }

    public addBehavior()
    {

        console.log('Cannot add a behavior to labels yet...');
        return this;

    }

}
