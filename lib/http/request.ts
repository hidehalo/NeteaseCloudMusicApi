import createRequest from '../../util/request'
import { ServerContext } from '../context'

class StaticIpRequest {
  ip: string;
  context: ServerContext;

  constructor(context: ServerContext, ip: string) {
    this.ip = ip;
    this.context = context;
  }

  send(
    method: string, 
    url: string, 
    data: object|undefined, 
    options: object|undefined) 
  {
      // deep copy
      let ip = this.ip.slice(0);
      if (ip.substr(0, 7) == '::ffff:') {
        ip = ip.substr(7)
      }
      const injectIpOptions = {...options, ip, context: this.context}

      return createRequest(method, url, data, injectIpOptions);
  }
}

export {
  StaticIpRequest
}
