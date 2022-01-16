import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import fs from 'fs';

export const saveSelectorTransformLocal = (context: MRE.Context, transform: MRE.ActorTransform ) => {
    if (transform?.local) {
        const transformSerialized = JSON.stringify(transform);
        const path = `${process.cwd()}/saved-data`;
        const sessionId = new Buffer(context.sessionId).toString('base64');
        const filename = `video-selector-${sessionId}.json`;
        fs.mkdir(path, { recursive: true}, function (err) {
            if (err) throw err;
            fs.writeFileSync(path + '/' + filename, transformSerialized);
        });
    }
}

export const retrieveSelectorTransformLocal = (context: MRE.Context): MRE.ActorTransform => {
    const path = `${process.cwd()}/saved-data`;
    const sessionId = new Buffer(context.sessionId).toString('base64');
    const filename = path + '/' + `video-selector-${sessionId}.json`;
    try {
        const val = fs.readFileSync(filename, "utf8");
        return val ? JSON.parse(val) : undefined;
    } catch(err) {
        console.error(err);
    }
    return undefined;
}
