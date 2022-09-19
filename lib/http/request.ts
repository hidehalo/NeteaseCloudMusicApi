import createRequest from '../../util/request'

export function requestWrapper(
  ip: string, 
  method: string, 
  url: string, 
  data: object|undefined, 
  options: object|undefined)
{
  if (ip.substr(0, 7) == '::ffff:') {
    ip = ip.substr(7)
  }
  const injectIpOptions = {...options, ip}

  return createRequest(method, url, data, injectIpOptions);
}
