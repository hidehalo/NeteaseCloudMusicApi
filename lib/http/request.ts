import createRequest from '../../util/request'

class StaticIpRequest {
  ip: string;

  constructor(ip: string) {
    this.ip = ip;
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
      const injectIpOptions = {...options, ip}
    
      return createRequest(method, url, data, injectIpOptions);
  }
}

export {
  StaticIpRequest
}
