import {$$asyncIterator} from 'iterall'

export default class AsyncIterator {
  constructor(pubSubEngine, subNames, options) {
    this.pubsub = pubSubEngine
    this.pullQueue = []
    this.pushQueue = []
    this.listening = true
    this.eventsArray = typeof subNames === 'string' ? [subNames] : subNames
    this.allSubscribed = this.subscribeAll()
    this.options = options
  }

  next() {
    return this.allSubscribed.then(() => this.listening ? this.pullValue() : this.return())
  }

  return() {
    return this.allSubscribed.then(subs => {
      this.emptyQueue(subs)
      return { value: undefined, done: true }
    })
  }

  throw(error) {
    return this.allSubscribed.then(subs => {
      this.emptyQueue(subs)
      return Promise.reject(error)
    })
  }

  [$$asyncIterator]() {
    return this
  }

  pushValue(event) {
    this.allSubscribed.then(() => {
      if (this.pullQueue.length !== 0) {
        this.pullQueue.shift()({ value: event, done: false })
      } else {
        this.pushQueue.push(event)
      }
    })
  }

  pullValue() {
    return new Promise(resolve => {
      if (this.pushQueue.length !== 0) {
        const res = this.pushQueue.shift()
        resolve({ value: res, done: false })
      } else {
        this.pullQueue.push(resolve)
      }
    })
  }

  emptyQueue(subscriptionIds) {
    if (this.listening) {
      this.listening = false
      this.unsubscribeAll(subscriptionIds)
      this.pullQueue.forEach(resolve => resolve({ value: undefined, done: true }))
      this.pullQueue.length = 0
      this.pushQueue.length = 0
    }
  }

  subscribeAll() {
    return Promise.all(this.eventsArray.map(
      eventName => this.pubsub.subscribe(eventName, this.pushValue.bind(this), this.options)
    ))
  }

  unsubscribeAll(subscriptionIds) {
    for (const subscriptionId of subscriptionIds) {
      this.pubsub.unsubscribe(subscriptionId)
    }
  }
}
