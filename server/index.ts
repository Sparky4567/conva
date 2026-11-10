import { options, setPublisher } from './app';
const server = Bun.serve(options);
setPublisher(server);
console.log(`Skype is running at ${server.url}`);
