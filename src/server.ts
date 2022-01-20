import {log, Permissions, WebHost} from '@microsoft/mixed-reality-extension-sdk';
import {resolve as resolvePath} from 'path';
import LiveStreamVideoPlayer from './app';
import dotenv from 'dotenv';
import MediaFileTestPlayer from './app-media-file';

// Read .env if file exists
dotenv.config();

log.enable('app');
// log.enable('network');

process.on('uncaughtException', (err) => console.log('uncaughtException', err));
process.on('unhandledRejection', (reason) => console.log('unhandledRejection', reason));

 // Start listening for connections, and serve static files
 // Note that process.env.BASE_URL/PORT variables will automatically be used if defined in the .env file
const server = new WebHost({
   baseDir: resolvePath(__dirname, '../public'),
   optionalPermissions: [Permissions.UserInteraction],
   // baseUrl: 'http://108.72.45.167:3901',
   // port: 3901,
});

server.adapter

// Handle new application sessions
server.adapter.onConnection((context, params) => {
   console.log("Starting params", params)
   if (params?.type as 'live' | 'file' === 'live') {
      return new LiveStreamVideoPlayer(context, params);
   }
   return new MediaFileTestPlayer(context, params);
});

export default server;
