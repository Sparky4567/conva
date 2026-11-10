import { options, setPublisher } from './app';
const server = Bun.serve(options);
setPublisher(server);
console.log(`Conva is running at ${server.url}`);
