import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import { S3, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const s3Client = new S3({
    endpoint: "https://nyc3.digitaloceanspaces.com",
    region: "us-east-1",
    credentials: {
        accessKeyId: process.env.SPACES_KEY,
        secretAccessKey: process.env.SPACES_SECRET
    }
});

const Bucket = process.env.SPACES_NAME;

// Need to save to a S3 store
export const saveSelectorTransformLocal = async (context: MRE.Context, transform: MRE.ActorTransform ) => {
    if (transform?.local) {
        const transformSerialized = JSON.stringify(transform);
        const bucketParams = {
            Bucket,
            Key: getPath(context),
            Body: transformSerialized
        };
        const data = await s3Client.send(new PutObjectCommand(bucketParams));
        console.log(new Date(), `Successfully saved selection cards transform data for ${context.sessionId}`);
    }
}
// Function to turn the file's body into a string.
const streamToString = (stream: any): Promise<string> => {
    const chunks: Uint8Array[] | Buffer[] = [];
    return new Promise((resolve, reject) => {
        stream.on('data', (chunk: ArrayBuffer | SharedArrayBuffer) => chunks.push(Buffer.from(chunk)));
        stream.on('error', (err: any) => reject(err));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
};

const getPath = (context: MRE.Context) => {
    const path = `saved-data`;
    const sessionId = new Buffer(context.sessionId).toString('base64');
    return `${path}/video-selector-${sessionId}.json`;
}

export const retrieveSelectorTransformLocal = async (context: MRE.Context): Promise<MRE.ActorTransform> => {
    const key = getPath(context);
    const bucketParams = {
        Bucket,
        Key: getPath(context),
    };
    try {
        const response = await s3Client.send(new GetObjectCommand(bucketParams));
        const val = await streamToString(response.Body);
        console.log(`Successfully retrieved transform data for ${context.sessionId}`);
        return val ? JSON.parse(val) : undefined;
    } catch(err) {
        console.error(err);
    }
    return undefined;
}
