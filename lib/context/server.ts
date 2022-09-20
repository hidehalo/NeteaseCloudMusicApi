import EventEmitter from "events";

interface Events {
  done: () => any
}


class ServerContext {

  delegate: EventEmitter

  constructor() {
    this.delegate = new EventEmitter({captureRejections:true});
    this.delegate.setMaxListeners(Infinity);
  }

  on<E extends keyof Events>(event: E, listener: Events[E]) {
    return this.delegate.on(event, listener);
  }

  emit<E extends keyof Events>(event: E, ...args: any[]) {
    return this.delegate.emit(event, ...args);
  }
}

export {
  ServerContext
}
