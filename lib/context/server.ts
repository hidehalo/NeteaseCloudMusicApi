import EventEmitter from "events";
import { Logger } from 'winston'

interface Events {
  done: () => any
}


class ServerContext {

  delegate: EventEmitter
  logger: Logger

  constructor(logger: Logger) {
    this.logger = logger;
    this.delegate = new EventEmitter({captureRejections:true});
    this.delegate.setMaxListeners(Infinity);
  }

  on<E extends keyof Events>(event: E, listener: Events[E]) {
    return this.delegate.on(event, listener);
  }

  emit<E extends keyof Events>(event: E, ...args: any[]) {
    return this.delegate.emit(event, ...args);
  }

  once<E extends keyof Events>(event: E, listener: Events[E]) {
    return this.delegate.once(event, listener);
  }
}

export {
  ServerContext
}
