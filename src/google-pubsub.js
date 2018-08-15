import PubSub from '@google-cloud/pubsub'
import AsyncIterator from './async-iterator'

const subName2Log = subName => `${subName}\t${subName === 'article-pod-jonas-subscription' ? '\t\t' : ''}`
const ids2Log = ids => typeof ids !== 'undefined' ? JSON.stringify(ids) : '-'

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

    const {ids, ...rest} = this.googleSubName2GoogleSubAndClientIds[subName] || {}
    console.log('-x-x-x-x-x-', 'sub\t\t', 'subName\t', subName2Log(subName), 'id\t', id + '\t', 'ids\t', ids2Log(ids) + '\t', 'existing\t', !!ids && ids.length > 0)
    if (ids && ids.length > 0) {
      this.googleSubName2GoogleSubAndClientIds[subName] = {...rest, ids: [...ids, id]}
      return Promise.resolve(id)
    } else {
      return this.getSubscription(topicName, subName).then(sub => {
        const messageHandler = this.getMessageHandler(subName)
        sub.on('message', messageHandler)
        sub.on('error', error => console.error(error))
        const {ids: oldIds = []} = this.googleSubName2GoogleSubAndClientIds[subName] || {}
        this.googleSubName2GoogleSubAndClientIds[subName] = {
          messageHandler,
          sub,
          ids: [...oldIds, id]
        }
        return id
      })
    }
  }

  getMessageHandler(subName) {
    function handleMessage (message) {
      message.ack()
      Promise.resolve(message).then(this.commonMessageHandler).then(res => {
        const {ids} = this.googleSubName2GoogleSubAndClientIds[subName] || {}
        console.log('-x-x-x-x-x-', 'handleMessage\t', 'subName\t', subName2Log(subName), '\t', '\t', 'ids\t', ids2Log(ids) + '\t', 'type\t', message.data.toString())
        ids.forEach(id => {
          const [, onMessage] = this.clientId2GoogleSubNameAndClientCallback[id]
          onMessage(res)
        })
      }).catch(e => console.log(e))
    }
    return handleMessage.bind(this)
  }

  unsubscribe(subId) {
    const [subName] = this.clientId2GoogleSubNameAndClientCallback[subId]
    const {ids, sub, messageHandler} = this.googleSubName2GoogleSubAndClientIds[subName] || {}
    console.log('-x-x-x-x-x-', 'unsub\t\t', 'subName\t', subName2Log(subName), 'id\t', subId + '\t', 'ids\t', ids2Log(ids))

    if (!ids) throw new Error(`There is no subscription of id "${subId}"`)

    if (ids.length === 1) {
      console.log('-x-x-x-x-x-', 'removeListener\t', 'subName\t', subName2Log(subName), 'id\t', subId + '\t', 'ids\t', ids2Log(ids))
      sub.removeListener('message', messageHandler)
      // sub.delete()
      delete this.googleSubName2GoogleSubAndClientIds[subName]
    } else {
      const index = ids.indexOf(subId)
      this.googleSubName2GoogleSubAndClientIds[subName] =
        {sub, ids: index === -1 ? ids : [...ids.slice(0, index), ...ids.slice(index + 1)], messageHandler}
    }
    delete this.clientId2GoogleSubNameAndClientCallback[subId]
  }

  asyncIterator(triggers, options) {
    return new AsyncIterator(this, triggers, options)
  }
}
