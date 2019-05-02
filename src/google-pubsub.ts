import { PubSub } from '@google-cloud/pubsub';
import { PubSubEngine } from 'graphql-subscriptions';
import { PubSubAsyncIterator } from './async-iterator';

class NoSubscriptionOfIdError extends Error {
  constructor(subId) {
    super(`There is no subscription of id "${subId}"`);
  }
}

export default class GooglePubSub implements PubSubEngine {
  constructor(
    config?,
    topic2SubName: Topic2SubName = topicName => `${topicName}-subscription`,
    commonMessageHandler: CommonMessageHandler = message => message,
    pubSubClient = new PubSub(config)
  ) {
    this.clientId2GoogleSubNameAndClientCallback = {};
    this.googleSubName2GoogleSubAndClientIds = {};
    this.currentClientId = 0;
    this.pubSubClient = pubSubClient;
    this.topic2SubName = topic2SubName;
    this.commonMessageHandler = commonMessageHandler;
  }

  public publish(topicName: string, data: any, attributes?: object) {
    if (typeof data !== 'string') {
      data = JSON.stringify(data);
    }
    return this.pubSubClient
      .topic(topicName)
      .publish(Buffer.from(data), attributes);
  }

  private async getSubscription(topicName, subName) {
    const sub = this.pubSubClient.subscription(subName);
    const [exists] = await sub.exists();
    if (exists) {
      return sub;
    } else {
      const [newSub] = await this.pubSubClient.topic(topicName).createSubscription(subName);
      return newSub;
    }
  }

  public async subscribe(topicName, onMessage, options?) {
    const subName = this.topic2SubName(topicName, options);
    const id = this.currentClientId++;
    this.clientId2GoogleSubNameAndClientCallback[id] = [subName, onMessage];

    const { ids: oldIds = [], ...rest } = this.googleSubName2GoogleSubAndClientIds[subName] || {};
    this.googleSubName2GoogleSubAndClientIds[subName] = { ...rest, ids: [...oldIds, id] };
    if (oldIds.length > 0) return Promise.resolve(id);
    const sub = await this.getSubscription(topicName, subName);
    const googleSubAndClientIds = this.googleSubName2GoogleSubAndClientIds[subName] || {};
    // all clients have unsubscribed before the async subscription was created
    if (!googleSubAndClientIds.ids.length) return id;
    const messageHandler = this.getMessageHandler(subName);
    const errorHandler = error => console.error(error);
    sub.on('message', messageHandler);
    sub.on('error', errorHandler);

    this.googleSubName2GoogleSubAndClientIds[subName] = {
      ...googleSubAndClientIds,
      messageHandler,
      errorHandler,
      sub
    };
    return id;
  }

  private getMessageHandler(subName) {
    const engine = this;
    async function handleMessage(message) {
      message.ack();
      const res = await engine.commonMessageHandler(message);
      const { ids = [] } = engine.googleSubName2GoogleSubAndClientIds[subName] || {};
      ids.forEach(id => {
        const [, onMessage] = engine.clientId2GoogleSubNameAndClientCallback[id];
        onMessage(res);
      });
    }
    return handleMessage.bind(this);
  }

  public unsubscribe(subId) {
    const [subName] = this.clientId2GoogleSubNameAndClientCallback[subId] || [undefined];
    if (!subName) throw new NoSubscriptionOfIdError(subId);
    const googleSubAndClientIds = this.googleSubName2GoogleSubAndClientIds[subName] || {};
    const { ids } = googleSubAndClientIds;

    if (!ids) throw new NoSubscriptionOfIdError(subId);

    if (ids.length === 1) {
      const { sub, messageHandler, errorHandler } = googleSubAndClientIds;
      // only remove listener if the client didn't unsubscribe before the subscription was created
      if (sub) {
        sub.removeListener('message', messageHandler);
        sub.removeListener('error', errorHandler);
      }
      // sub.delete()
      delete this.googleSubName2GoogleSubAndClientIds[subName];
    } else {
      const index = ids.indexOf(subId);
      this.googleSubName2GoogleSubAndClientIds[subName] = {
        ...googleSubAndClientIds,
        ids: index === -1 ? ids : [...ids.slice(0, index), ...ids.slice(index + 1)]
      };
    }
    delete this.clientId2GoogleSubNameAndClientCallback[subId];
  }

  public asyncIterator<T>(topics: string | string[], options?): AsyncIterator<T> {
    return new PubSubAsyncIterator(this, topics, options);
  }

  private commonMessageHandler: CommonMessageHandler;
  private topic2SubName: Topic2SubName;
  public pubSubClient: any; // Todo: type

  // [subName: string, onMessage: Function]
  private clientId2GoogleSubNameAndClientCallback: { [clientId: number]: [string, Function] };
  private googleSubName2GoogleSubAndClientIds: { [topic: string]: GoogleSubAndClientIds };
  private currentClientId: number;
}

type GoogleSubAndClientIds = {
  sub?: any; // Todo: type
  messageHandler?: Function;
  errorHandler?: Function;
  ids?: Array<number>;
};
export type Topic = string;
export type Topic2SubName = (topic: Topic, subscriptionOptions?: Object) => string;
export type CommonMessageHandler = (message: any) => any; // Todo: maybe type message
