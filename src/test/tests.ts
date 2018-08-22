import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { spy, restore } from 'simple-mock';
import { isAsyncIterable } from 'iterall';
import { GooglePubSub } from './../index'

chai.use(chaiAsPromised);
const expect = chai.expect;

// -------------- Mocking Google PubSub Client ------------------

function getMockedGooglePubSub () {
  let listener;

  const ackSpy = spy(() => {});

  const publisherMock = {
      publish: spy((data, attributes) => listener && listener({ack: ackSpy,data, attributes}))
  };

  const topicMock = {
      publisher: spy(() => publisherMock),
      createSubscription: spy(subName => Promise.resolve([subscriptionMock]))
  };

  const removeListenerSpy = spy((event, cb) => {
      if (event === 'message') {
          listener = null;
      }
  });

  const addListenerSpy = spy((event, cb) => {
      if (event === 'message') {
          listener = cb;
      }
  });

  const subscriptionMock = {
      exists: spy(subName => Promise.resolve(true)),
      on: addListenerSpy,
      removeListener: removeListenerSpy,
  };

  const mockGooglePubSubClient = {
      topic: spy(topic => topicMock),
      subscription: spy(subName => subscriptionMock)
  };

  const pubSub = new GooglePubSub(undefined, undefined, undefined, mockGooglePubSubClient)

  return {pubSub, addListenerSpy, removeListenerSpy};
}

// wait for the promise of the message handler
const asyncMessageHandler = () => new Promise(resolve => setTimeout(resolve, 0));

// -------------- Mocking Google PubSub Client ------------------

describe('GooglePubSub', () => {

  it('can subscribe to specific topic and called when a message is published on it', done => {
    const {pubSub} = getMockedGooglePubSub();
    pubSub.subscribe('Posts', message => {
      try {
        expect(message.data.toString()).to.equals('test');
        done();
      } catch (e) {
        done(e);
      }

    }).then(async subId => {
      expect(subId).to.be.a('number');
      pubSub.publish('Posts', 'test');
      await asyncMessageHandler();
      pubSub.unsubscribe(subId)
    });
  });

  it('can unsubscribe from specific topic', done => {
    const {pubSub, removeListenerSpy} = getMockedGooglePubSub();
    pubSub.subscribe('Posts', () => null).then(subId => {
      pubSub.unsubscribe(subId);

      try {
        expect(removeListenerSpy.callCount).to.equals(2); // error and message listener
        expect(removeListenerSpy.calls[0].args[0]).to.equals('message');
        expect(removeListenerSpy.calls[1].args[0]).to.equals('error');
        done();

      } catch (e) {
        done(e);
      }
    });
  });

  it('cleans up correctly the memory when unsubscribing', done => {
    const {pubSub} = getMockedGooglePubSub();
    Promise.all([
      pubSub.subscribe('Posts', () => null),
      pubSub.subscribe('Posts', () => null),
    ])
      .then(([subId, secondSubId]) => {
        try {
          // This assertion is done against a private member, if you change the internals, you may want to change that
          expect((pubSub as any).clientId2GoogleSubNameAndClientCallback[subId]).not.to.be.an('undefined');
          pubSub.unsubscribe(subId);
          // This assertion is done against a private member, if you change the internals, you may want to change that
          expect((pubSub as any).clientId2GoogleSubNameAndClientCallback[subId]).to.be.an('undefined');
          expect(() => pubSub.unsubscribe(subId)).to.throw(`There is no subscription of id "${subId}"`);
          pubSub.unsubscribe(secondSubId);
          done();

        } catch (e) {
          done(e);
        }
      });
  });

  it('will not unsubscribe from the topic if there is another subscriber on it\'s subscriber list', done => {
    const {pubSub, removeListenerSpy} = getMockedGooglePubSub();
    const subscriptionPromises = [
      pubSub.subscribe('Posts', () => {
        done('Not supposed to be triggered');
      }),
      pubSub.subscribe('Posts', (message) => {
        try {
          expect(message.data.toString()).to.equals('test');
          done();
        } catch (e) {
          done(e);
        }
      }),
    ];

    Promise.all(subscriptionPromises).then(async subIds => {
      try {
        expect(subIds.length).to.equals(2);

        pubSub.unsubscribe(subIds[0]);
        expect(removeListenerSpy.callCount).to.equals(0);

        pubSub.publish('Posts', 'test');
        await asyncMessageHandler();
        pubSub.unsubscribe(subIds[1]);
        expect(removeListenerSpy.callCount).to.equals(2); // error and message listener
        expect(removeListenerSpy.calls[0].args[0]).to.equals('message');
        expect(removeListenerSpy.calls[1].args[0]).to.equals('error');
      } catch (e) {
        done(e);
      }
    });
  });

  it('will subscribe to topic only once', done => {
    const {pubSub, addListenerSpy} = getMockedGooglePubSub();
    const onMessage = () => null;
    const subscriptionPromises = [
      pubSub.subscribe('Posts', onMessage),
      pubSub.subscribe('Posts', onMessage),
    ];

    Promise.all(subscriptionPromises).then(subIds => {
      try {
        expect(subIds.length).to.equals(2);
        expect(addListenerSpy.callCount).to.equals(2); // error and message listener
        expect(addListenerSpy.calls[0].args[0]).to.equals('message');
        expect(addListenerSpy.calls[1].args[0]).to.equals('error');

        pubSub.unsubscribe(subIds[0]);
        pubSub.unsubscribe(subIds[1]);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  /*it('can have multiple subscribers and all will be called when a message is published to this channel', done => {
    const {pubSub, addListenerSpy, removeListenerSpy} = getMockedGooglePubSub();
    const onMessageSpy = spy(() => null);
    const subscriptionPromises = [
      pubSub.subscribe('Posts', onMessageSpy as Function),
      pubSub.subscribe('Posts', onMessageSpy as Function),
    ];

    Promise.all(subscriptionPromises).then(subIds => {
      try {
        expect(subIds.length).to.equals(2);

        pubSub.publish('Posts', 'test');

        expect(onMessageSpy.callCount).to.equals(2);
        onMessageSpy.calls.forEach(call => {
          expect(call.args).to.have.members(['test']);
        });

        pubSub.unsubscribe(subIds[0]);
        pubSub.unsubscribe(subIds[1]);
        done();
      } catch (e) {
        done(e);
      }
    });
  });*/

  /*it('can publish objects as well', done => {
    const {pubSub, addListenerSpy, removeListenerSpy} = getMockedGooglePubSub();
    pubSub.subscribe('Posts', message => {
      try {
        expect(message).to.have.property('comment', 'This is amazing');
        done();
      } catch (e) {
        done(e);
      }
    }).then(subId => {
      try {
        pubSub.publish('Posts', { comment: 'This is amazing' });
        pubSub.unsubscribe(subId);
      } catch (e) {
        done(e);
      }
    });
  });*/

  /*it('can accept custom reviver option (eg. for Javascript Dates)', done => {
    const dateReviver = (key, value) => {
      const isISO8601Z = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)Z$/;
      if (typeof value === 'string' && isISO8601Z.test(value)) {
        const tempDateNumber = Date.parse(value);
        if (!isNaN(tempDateNumber)) {
          return new Date(tempDateNumber);
        }
      }
      return value;
    };

    const {pubSub, addListenerSpy, removeListenerSpy} = new GooglePubSub({...mockOptions, reviver: dateReviver});
    const validTime = new Date();
    const invalidTime = '2018-13-01T12:00:00Z';
    pubSub.subscribe('Times', message => {
      try {
        expect(message).to.have.property('invalidTime', invalidTime);
        expect(message).to.have.property('validTime');
        expect(message.validTime.getTime()).to.equals(validTime.getTime());
        done();
      } catch (e) {
        done(e);
      }
    }).then(subId => {
      try {
        pubSub.publish('Times', { validTime, invalidTime });
        pubSub.unsubscribe(subId);
      } catch (e) {
        done(e);
      }
    });
  });*/

  it('throws if you try to unsubscribe with an unknown id', () => {
    const {pubSub, addListenerSpy, removeListenerSpy} = getMockedGooglePubSub();
    return expect(() => pubSub.unsubscribe(123))
      .to.throw('There is no subscription of id "123"');
  });

  /*it('can use transform function to convert the trigger name given into more explicit channel name', done => {
    const triggerTransform = (trigger, { repoName }) => `${trigger}.${repoName}`;
    const pubSub = new GooglePubSub({
      triggerTransform,
    });

    const validateMessage = message => {
      try {
        expect(message).to.equals('test');
        done();
      } catch (e) {
        done(e);
      }
    };

    pubSub.subscribe('comments', validateMessage, { repoName: 'graphql-google-pubsub-subscriptions' }).then(subId => {
      pubSub.publish('comments.graphql-google-pubsub-subscriptions', 'test');
      pubSub.unsubscribe(subId);
    });

  });*/

  after('Restore Google PubSub client mock', () => {
    // restore();
  });

});

describe('PubSubAsyncIterator', () => {

  it('should expose valid asyncItrator for a specific event', () => {
    const {pubSub} = getMockedGooglePubSub();
    const eventName = 'test';
    const iterator = pubSub.asyncIterator(eventName);
    // tslint:disable-next-line:no-unused-expression
    expect(iterator).to.exist;
    // tslint:disable-next-line:no-unused-expression
    expect(isAsyncIterable(iterator)).to.be.true;
  });

  /*it('should trigger event on asyncIterator when published', done => {
    const {pubSub, addListenerSpy, removeListenerSpy} = getMockedGooglePubSub();
    const eventName = 'test';
    const iterator = pubSub.asyncIterator(eventName);

    iterator.next().then(result => {
      // tslint:disable-next-line:no-unused-expression
      expect(result).to.exist;
      // tslint:disable-next-line:no-unused-expression
      expect(result.value).to.exist;
      // tslint:disable-next-line:no-unused-expression
      expect(result.done).to.exist;
      done();
    });

    pubSub.publish(eventName, { test: true });
  });*/

  it('should not trigger event on asyncIterator when publishing other event', () => {
    const {pubSub} = getMockedGooglePubSub();
    const eventName = 'test2';
    const iterator = pubSub.asyncIterator('test');
    const triggerSpy = spy(() => undefined);

    iterator.next().then(triggerSpy);
    pubSub.publish(eventName, { test: true });
    expect(triggerSpy.callCount).to.equal(0);
  });

  /*it('register to multiple events', done => {
    const pubSub = getMockedGooglePubSub();
    const eventName = 'test2';
    const iterator = pubSub.asyncIterator(['test', 'test2']);
    const triggerSpy = spy(() => undefined);

    iterator.next().then(() => {
      triggerSpy();
      expect(triggerSpy.callCount).to.be.gte(1);
      done();
    });
    pubSub.publish(eventName, { test: true });
  });*/

  /*it('should not trigger event on asyncIterator already returned', done => {
    const pubSub = getMockedGooglePubSub();
    const eventName = 'test';
    const iterator = pubSub.asyncIterator<any>(eventName);

    iterator.next().then(result => {
      // tslint:disable-next-line:no-unused-expression
      expect(result).to.exist;
      // tslint:disable-next-line:no-unused-expression
      expect(result.value).to.exist;
      expect(result.value.test).to.equal('word');
      // tslint:disable-next-line:no-unused-expression
      expect(result.done).to.be.false;
    });

    pubSub.publish(eventName, { test: 'word' });

    iterator.next().then(result => {
      // tslint:disable-next-line:no-unused-expression
      expect(result).to.exist;
      // tslint:disable-next-line:no-unused-expression
      expect(result.value).not.to.exist;
      // tslint:disable-next-line:no-unused-expression
      expect(result.done).to.be.true;
      done();
    });

    iterator.return();
    pubSub.publish(eventName, { test: true });
  });*/

});
