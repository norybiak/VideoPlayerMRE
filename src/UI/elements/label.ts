import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import { Resources } from '../core/UI';
import { Element, ElementOptions } from '../core/element';
import merge from 'deepmerge';

/** @internal */
export class Label extends Element {

    constructor(text: string, context: MRE.Context, defaultActorLike: Partial<MRE.ActorLike>, resources: Resources, options?: ElementOptions) {

        super();

        let refinedActorLike = this._refineActorLike(text, resources, options);

        this._name = options.name;

        let actorLike = merge(defaultActorLike, refinedActorLike);
        this.createActor(context, actorLike);

    }

    public set(content: string) {

        this._actor.text.contents = content;

    }

    public clear() {

        this._actor.text.contents = "";

    }

    public addBehavior() {

        console.log('Cannot add a behavior to labels yet...');
        return this;

    }

    private _refineActorLike(text: string, resources: Resources, options?: ElementOptions) {

        let height = (options.height !== undefined) ? options.height : 1;
        let anchor = (options.anchor !== undefined) ? options.anchor : MRE.TextAnchorLocation.MiddleCenter;
        let justify = (options.justify !== undefined) ? options.justify : MRE.TextJustify.Center;
        let color = (options.color !== undefined) ? options.color : MRE.Color3.White();
        let contents = (text !== undefined) ? text : "";

        let textLike = {
            height,
            anchor,
            justify,
            color,
            contents
        }
    
        return {
            text: { ...textLike },
        };

    }

}