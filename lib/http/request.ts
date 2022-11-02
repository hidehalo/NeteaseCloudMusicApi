import createRequest from '../../util/request'
import { ServerContext } from '../context'

function handleIp(rawIp: string): string {
  // deep copy
  let ip = rawIp.slice(0);
  if (ip.substr(0, 7) == '::ffff:') {
    ip = ip.substr(7)
  }
  return ip
}

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
    data: object | undefined,
    options: object | undefined) {
    let ip = handleIp(this.ip);
    const injectIpOptions = { ...options, ip, context: this.context }

    return createRequest(method, url, data, injectIpOptions);
  }
}

export {
  StaticIpRequest,
  handleIp
}
