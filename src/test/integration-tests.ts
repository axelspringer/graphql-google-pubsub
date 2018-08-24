import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { mock } from 'simple-mock';
import {
  parse,
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
} from 'graphql';
import { isAsyncIterable } from 'iterall';
import { subscribe } from 'graphql/subscription';

import { GooglePubSub } from './../index'
import { withFilter } from 'graphql-subscriptions';

chai.use(chaiAsPromised);
const expect = chai.expect;

const FIRST_EVENT = process.env.GCP_PUBSUB_INTEGRATION_TEST_TOPIC;

function buildSchema(iterator) {
  return new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      fields: {
        testString: {
          type: GraphQLString,
          resolve: function(_, args) {
            return 'works';
          },
        },
      },
    }),
    subscription: new GraphQLObjectType({
      name: 'Subscription',
      fields: {
        testSubscription: {
          type: GraphQLString,
          subscribe: withFilter(() => iterator, () => true),
          resolve: root => {
            return 'FIRST_EVENT';
          },
        },
      },
    }),
  });
}

describe('PubSubAsyncIterator', function() {
  const query = parse(`
    subscription S1 {
      testSubscription
    }
  `);

  const pubsub = new GooglePubSub();
  const origIterator = pubsub.asyncIterator(FIRST_EVENT);
  const returnSpy = mock(origIterator, 'return');
  const schema = buildSchema(origIterator);
  const results = subscribe(schema, query);

  it('should allow subscriptions', () =>
    results
      .then(async ai => {
        // tslint:disable-next-line:no-unused-expression
        expect(isAsyncIterable(ai)).to.be.true;

        const r = ai.next();
        await pubsub.publish(FIRST_EVENT, {});

        return r;
      })
      .then(res => {
        expect(res.value.data.testSubscription).to.equal('FIRST_EVENT');
      })).timeout(6000);

  it('should clear event handlers', () =>
    results
      .then(ai => {
        // tslint:disable-next-line:no-unused-expression
        expect(isAsyncIterable(ai)).to.be.true;

        pubsub.publish(FIRST_EVENT, {});

        return ai.return();
      })
      .then(res => {
        expect(returnSpy.callCount).to.be.gte(1);
      }));
});
