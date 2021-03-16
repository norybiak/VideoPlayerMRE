import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import { Resources } from './UI';
import { Actor, ActorOptions } from './actor';
import { ElementOptions, ElementTypes } from './element';
import { Icon, Label } from '../elements';

export interface GroupOptions extends ActorOptions { 
    groupScale?: number
}

export type ElementArgs = [
    MRE.Context, 
    Partial<MRE.ActorLike>, 
    Resources,
    ElementOptions
]

export class Group extends Actor {

    public get name() { return this._name; };
    public get elements() { return [...this._elements.values()]; }
    public get actor() { return this._actor; }

    public get icons() { return this.elements.filter(el => el instanceof Icon) as Icon[]; }
    public get labels() { return this.elements.filter(el => el instanceof Label) as Label[]; }

    private _elements = new Map<string, ElementTypes>();
    private _name: string;
    private _groupScale: number;

    constructor(private _context: MRE.Context, private _resources: Resources, options?: GroupOptions) {

        super();

        this._name = options.name;

        this._groupScale = options.groupScale || 1;

        this._actor = MRE.Actor.Create(this._context, { actor: Actor._defaultActorLike(options) });
    }

    public createIcon(icon: string, options?: ElementOptions) {
        
        let el = new Icon(icon, ...this._args(options));
        this._elements.set(options.name, el);
        return el;

    }

    public createLabel(text: string, options?: ElementOptions) {

        let el = new Label(text, ...this._args(options));
        this._elements.set(options.name, el);
        return el;

    }
    
    public getIconByName(name: string) {

        if (this._elementExists(name)) {
            return this.icons.find(icon => icon.name === name);
        } 

    }

    public getLabelByName(name: string) {
        
        if (this._elementExists(name)) {
            return this.labels.find(icon => icon.name === name);
        } 
        
    }

    private _args(options?: ElementOptions) {

        //Options are modified here in order to add in group specific options
        options.name = this._checkName(options.name);
        options.parentId = (options.parentId !== undefined) ? options.parentId : this._actor.id;
        options.scale = (options.scale !== undefined) ? options.scale : { x: this._groupScale, y: this._groupScale, z: this._groupScale };

        let args: ElementArgs = [
            this._context,
            Actor._defaultActorLike(options),
            this._resources,
            options
        ];

        return args;

    }

    private _checkName(name: string) {

        name = name || "element";

        if (this._elements.has(name))  {

            let total = this._getTotalOfEntries(name);

            if (total > 0) {
                name += total.toString();
            }
        }

        return name;

    }

    private _elementExists(name: string) {

        if (!this._elements.has(name)) {
            console.log('App', `Icon [${ name }] doesn't exist! Did you set a name?`);
            return false;
        }

        return true;
    }

    private _getTotalOfEntries(name: string) {

        let total = 0;

        if (this._elements.size > 0) {
            this._elements.forEach((value, key) => {
                if (key.includes(name))
                    total++;
            });
        }

        return total;

    }
}
