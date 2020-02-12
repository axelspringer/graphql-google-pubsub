# graphql-google-pubsub

This package implements the PubSubEngine Interface from the [graphql-subscriptions](https://github.com/apollographql/graphql-subscriptions) package and also the new AsyncIterator interface. 
It allows you to connect your subscriptions manger to a Google PubSub mechanism to support 
multiple subscription manager instances.

## Installation

`npm install @axelspringer/graphql-google-pubsub` 
or
`yarn add @axelspringer/graphql-google-pubsub`
   
## Using as AsyncIterator

Define your GraphQL schema with a `Subscription` type:

```graphql
schema {
  query: Query
  mutation: Mutation
  subscription: Subscription
}

type Subscription {
    somethingChanged: Result
}

type Result {
    id: String
}
```

Now, let's create a simple `GooglePubSub` instance:

```javascript
import { GooglePubSub } from '@axelspringer/graphql-google-pubsub';
const pubsub = new GooglePubSub();
```

Now, implement your Subscriptions type resolver, using the `pubsub.asyncIterator` to map the event you need:

```javascript
const SOMETHING_CHANGED_TOPIC = 'something_changed';

export const resolvers = {
  Subscription: {
    somethingChanged: {
      subscribe: () => pubsub.asyncIterator(SOMETHING_CHANGED_TOPIC),
    },
  },
}
```

> Subscriptions resolvers are not a function, but an object with `subscribe` method, that returns `AsyncIterable`.

Calling the method `asyncIterator` of the `GooglePubSub` instance will subscribe to the topic provided and will return an `AsyncIterator` binded to the GooglePubSub instance and listens to any event published on that topic.
Now, the GraphQL engine knows that `somethingChanged` is a subscription, and every time we will use `pubsub.publish` over this topic, the `GooglePubSub` will `PUBLISH` the event to all other subscribed instances and those in their turn will emit the event to GraphQL using the `next` callback given by the GraphQL engine.

```js
pubsub.publish(SOMETHING_CHANGED_TOPIC, { somethingChanged: { id: "123" }});
```

The topic doesn't get created automatically, it has to be created beforehand.

If you publish non string data it gets stringified and you have to [parse the received message data](#receive-messages).

## Receive Messages

The [received message](https://googleapis.dev/nodejs/pubsub/1.1.5/Message.html) from Google PubSub gets directly passed as payload to the resolve/filter function.

You might extract the data (Buffer) in there or use a [common message handler](#commonmessagehandler) to transform the received message.

```javascript
function commonMessageHandler ({attributes = {}, data = ''}) {
  return {
    ...attributes,
    text: data.toString()
  };
}
```

The `can use custom message handler` test illustrates the flexibility of the common message handler.

## Dynamically use a topic based on subscription args passed on the query:

```javascript
export const resolvers = {
  Subscription: {
    somethingChanged: {
      subscribe: (_, args) => pubsub.asyncIterator(`${SOMETHING_CHANGED_TOPIC}.${args.relevantId}`),
    },
  },
}
```

## Using both arguments and payload to filter events

```javascript
import { withFilter } from 'graphql-subscriptions';

export const resolvers = {
  Subscription: {
    somethingChanged: {
      subscribe: withFilter(
        (_, args) => pubsub.asyncIterator(`${SOMETHING_CHANGED_TOPIC}.${args.relevantId}`),
        (payload, variables) => payload.somethingChanged.id === variables.relevantId,
      ),
    },
  },
}
```

## Creating the Google PubSub Client

```javascript
import { GooglePubSub } from '@axelspringer/graphql-google-pubsub';

const pubSub = new GooglePubSub(options, topic2SubName, commonMessageHandler)
```

### Options
These are the [options](https://googleapis.dev/nodejs/pubsub/1.1.5/global.html#ClientConfig) which are passed to the internal or passed Google PubSub client.
The client will extract credentials, project name etc. from environment variables if provided.
Have a look at the [authentication guide](https://cloud.google.com/docs/authentication/getting-started) for more information.
Otherwise you can provide this details in the options.
```javascript
const options = {
  projectId: 'project-abc',
  credentials:{
    client_email: 'client@example-email.iam.gserviceaccount.com',
    private_key: '-BEGIN PRIVATE KEY-\nsample\n-END PRIVATE KEY-\n'
  }
};
```

#### Subscription Options

[Subscription options](https://googleapis.dev/nodejs/pubsub/1.1.5/global.html#CreateSubscriptionRequest) can be passed into `subscribe` or `asyncInterator`.

Note: [google.protobuf.Duration](https://googleapis.dev/nodejs/pubsub/1.1.5/google.protobuf.html#.Duration) types must be passed in as an object with a seconds property (`{ seconds: 123 }`).

```javascript
const dayInSeconds = 60 * 60 * 24;

const subscriptionOptions = {
  messageRetentionDuration: { seconds: dayInSeconds },
  expirationPolicy: {
    ttl: { seconds: dayInSeconds * 2 }, // 2 Days
  },
};

await pubsub.asyncIterator("abc123", subscriptionOptions);
```

### topic2SubName

Allows building different workflows. If you listen on multiple server instances to the same subscription, the messages will get distributed between them.
Most of the time you want different subscriptions per server. That way every server instance can inform their clients about a new message.

```javascript
const topic2SubName = topicName => `${topicName}-${serverName}-subscription`
```

### commonMessageHandler

The common message handler gets called with the received message from Google PubSub.
You can transform the message before it is passed to the individual filter/resolver methods of the subscribers.
This way it is for example possible to inject one instance of a [DataLoader](https://github.com/facebook/dataloader) which can be used in all filter/resolver methods.

```javascript
const getDataLoader = () => new DataLoader(...);
const commonMessageHandler = ({attributes: {id}, data}) => ({id, dataLoader: getDataLoader()});
```

```javascript
export const resolvers = {
  Subscription: {
    somethingChanged: {
      resolve: ({id, dataLoader}) => dataLoader.load(id)
    },
  },
}
```

## Author

[Jonas Hackenberg - jonas-arkulpa](https://github.com/jonas-arkulpa)

## Acknowledgements

This project is mostly inspired by [graphql-redis-subscriptions](https://github.com/davidyaha/graphql-redis-subscriptions).
Many thanks to its authors for their work and inspiration. Thanks to the Lean Team ([Daniel Vogel](https://github.com/herr-vogel), [Martin Thomas](https://github.com/mthomas87), [Marcel Dohnal](https://github.com/mdohnal), [Florian Tatzky](https://github.com/pferdone), [Sebastian Herrlinger](https://github.com/kommander), [Mircea Craculeac](https://github.com/emzaeh) and [Tim Susa](https://github.com/TimSusa)).

