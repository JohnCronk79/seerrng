declare module 'http-proxy-agent' {
  import { Agent } from 'node:http';

  export class HttpProxyAgent<Uri extends string = string> extends Agent {
    constructor(proxy: Uri | URL, options?: object);
  }
}

declare module 'https-proxy-agent' {
  import { Agent } from 'node:https';

  export class HttpsProxyAgent<Uri extends string = string> extends Agent {
    constructor(proxy: Uri | URL, options?: object);
  }
}
