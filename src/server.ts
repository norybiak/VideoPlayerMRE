import { log, WebHost } from '@microsoft/mixed-reality-extension-sdk';
import { resolve as resolvePath } from 'path';
import App from './app';

log.enable('app');
//log.enable('network');

process.on('uncaughtException', (err) => console.log('uncaughtException', err));
process.on('unhandledRejection', (reason) => console.log('unhandledRejection', reason));

 // Start listening for connections, and serve static files
const server = new WebHost({
   baseDir: resolvePath(__dirname, '../public'),
   baseUrl: "http://localhost:3901",
   port: 3901
});

// Handle new application sessions
server.adapter.onConnection((context, params) => new App(context, server.baseUrl, params));

export default server;