import PubSub from '@google-cloud/pubsub'
import AsyncIterator from './async-iterator'

class NoSubscriptionOfIdError extends Error {
  constructor(subId) {
    super(`There is no subscription of id "${subId}"`)
  }
}

export default class GooglePubSub {
  constructor(
    config,
    topic2SubName = topicName => `${topicName}-subscription`,
    commonMessageHandler = message => message,
    pubSubClient = new PubSub(config)
  ) {
    this.clientId2GoogleSubNameAndClientCallback = {}
    this.googleSubName2GoogleSubAndClientIds = {}
    this.currentClientId = 0
    this.pubSubClient = pubSubClient
    this.topic2SubName = topic2SubName
    this.commonMessageHandler = commonMessageHandler
  }

  publish(topicName, data, attributes) {
    if (typeof data !== 'string') {
      data = JSON.stringify(data)
    }
    return this.pubSubClient.topic(topicName).publisher().publish(Buffer.from(data), attributes)
  }

  getSubscription(topicName, subName) {
    const sub = this.pubSubClient.subscription(subName)
    return sub.exists().then(res => res[0]).then(exists => {
      if (exists) {
        return sub
      } else {
        return this.pubSubClient.topic(topicName).createSubscription(subName)
          .then(results => results[0])
      }
    })
  }

  subscribe(topicName, onMessage, options) {
    const subName = this.topic2SubName(topicName, options)
    const id = this.currentClientId++
    this.clientId2GoogleSubNameAndClientCallback[id] = [subName, onMessage]

    const {ids: oldIds = [], ...rest} = this.googleSubName2GoogleSubAndClientIds[subName] || {}
    this.googleSubName2GoogleSubAndClientIds[subName] = {...rest, ids: [...oldIds, id]}
    if (oldIds.length > 0) return Promise.resolve(id)
    return this.getSubscription(topicName, subName).then(sub => {
      const googleSubAndClientIds = this.googleSubName2GoogleSubAndClientIds[subName] || {}
      // all clients have unsubscribed before the async subscription was created
      if (!googleSubAndClientIds.ids.length) return id;
      const messageHandler = this.getMessageHandler(subName)
      const errorHandler = error => console.error(error)
      sub.on('message', messageHandler)
      sub.on('error', errorHandler)

      this.googleSubName2GoogleSubAndClientIds[subName] = {
        ...googleSubAndClientIds,
        messageHandler,
        errorHandler,
        sub
      }
      return id
    })
  }

  getMessageHandler(subName) {
    function handleMessage (message) {
      message.ack()
      Promise.resolve(message).then(this.commonMessageHandler).then(res => {
        const {ids = []} = this.googleSubName2GoogleSubAndClientIds[subName] || {}
        ids.forEach(id => {
          const [, onMessage] = this.clientId2GoogleSubNameAndClientCallback[id]
          onMessage(res)
        })
      })
    }
    return handleMessage.bind(this)
  }

  unsubscribe(subId) {
    const [subName] = this.clientId2GoogleSubNameAndClientCallback[subId] || []
    if (!subName) throw new NoSubscriptionOfIdError(subId)
    const googleSubAndClientIds = this.googleSubName2GoogleSubAndClientIds[subName] || {}
    const {ids} = googleSubAndClientIds;

    if (!ids) throw new NoSubscriptionOfIdError(subId)

    if (ids.length === 1) {
      const {sub, messageHandler, errorHandler} = googleSubAndClientIds
      // only remove listener if the client didn't unsubscribe before the subscription was created
      if (sub) {
        sub.removeListener('message', messageHandler)
        sub.removeListener('error', errorHandler)
      }
      // sub.delete()
      delete this.googleSubName2GoogleSubAndClientIds[subName]
    } else {
      const index = ids.indexOf(subId)
      this.googleSubName2GoogleSubAndClientIds[subName] =
        {...googleSubAndClientIds, ids: index === -1 ? ids : [...ids.slice(0, index), ...ids.slice(index + 1)]}
    }
    delete this.clientId2GoogleSubNameAndClientCallback[subId]
  }

  asyncIterator(triggers, options) {
    return new AsyncIterator(this, triggers, options)
  }
}
