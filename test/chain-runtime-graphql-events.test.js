import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runtimeSource = await readFile(new URL('../chain-runtime.js', import.meta.url), 'utf8');
const adapterStart = runtimeSource.indexOf('const GRAPHQL_MOVE_EVENTS_QUERY =');
const adapterEnd = runtimeSource.indexOf('\nexport async function findCommerceV5MigrationByLegacyMaker');
assert.notEqual(adapterStart, -1, 'GraphQL Move-event adapter source is present');
assert.notEqual(adapterEnd, -1, 'GraphQL Move-event adapter source has a stable boundary');
const adapterModuleSource = `${runtimeSource
  .slice(adapterStart, adapterEnd)
  .replace('export function createGraphqlMoveEventAdapter', 'function createGraphqlMoveEventAdapter')}
export { createGraphqlMoveEventAdapter };`;
const { createGraphqlMoveEventAdapter } = await import(
  `data:text/javascript;base64,${Buffer.from(adapterModuleSource).toString('base64')}`
);

const EXPECTED_QUERY = `
  query AnimacraftMoveEvents($type: String!, $last: Int!, $before: String) {
    events(filter: { type: $type }, last: $last, before: $before) {
      pageInfo { hasPreviousPage startCursor }
      nodes {
        transaction { digest }
        sender { address }
        timestamp
        contents { type { repr } json bcs }
      }
    }
  }
`;

test('GraphQL Move-event adapter sends the exact backward query and capped variables', async () => {
  const requests = [];
  const client = {
    async query(request) {
      requests.push(request);
      return {
        data: {
          events: {
            pageInfo: { hasPreviousPage: true, startCursor: 'page-1' },
            nodes: [{ transaction: { digest: 'older' } }, { transaction: { digest: 'newer' } }],
          },
        },
      };
    },
  };

  const adapter = createGraphqlMoveEventAdapter({ client });
  const page = await adapter.queryEvents({
    query: { MoveEventType: ' 0xabc::pack::Created ' },
    order: 'descending',
    cursor: 'page-2',
    limit: 500,
  });

  assert.deepEqual(requests, [{
    query: EXPECTED_QUERY,
    variables: {
      type: '0xabc::pack::Created',
      last: 50,
      before: 'page-2',
    },
  }]);
  assert.deepEqual(page.data.map((event) => event.transaction.digest), ['newer', 'older']);
  assert.equal(page.hasNextPage, true);
  assert.equal(page.nextCursor, 'page-1');
  assert.equal(page.cursor, 'page-1');
  assert.equal(Object.isFrozen(page), true);
  assert.equal(Object.isFrozen(page.data), true);
});

test('GraphQL Move-event adapter defaults to 50 and closes the final page', async () => {
  let request;
  const adapter = createGraphqlMoveEventAdapter({
    client: {
      async query(value) {
        request = value;
        return {
          data: {
            events: {
              pageInfo: { hasPreviousPage: false, startCursor: 'ignored' },
              nodes: [{ contents: { json: { sequence: 1 } } }],
            },
          },
        };
      },
    },
  });

  const page = await adapter.queryEvents({
    query: { MoveEventType: '0xabc::pack::Created' },
  });

  assert.equal(request.variables.last, 50);
  assert.equal(request.variables.before, null);
  assert.equal(page.hasNextPage, false);
  assert.equal(page.nextCursor, null);
  assert.equal(page.cursor, null);
});

test('GraphQL Move-event adapter rejects GraphQL, transport, and malformed responses safely', async () => {
  const graphqlFailure = createGraphqlMoveEventAdapter({
    client: { async query() { return { errors: [{ message: 'indexer unavailable' }] }; } },
  });
  await assert.rejects(
    graphqlFailure.queryEvents({ query: { MoveEventType: '0x1::m::E' } }),
    (error) => error.code === 'SUI_GRAPHQL_EVENT_QUERY_FAILED'
      && error.message === 'indexer unavailable',
  );

  const transportCause = new Error('socket closed');
  const transportFailure = createGraphqlMoveEventAdapter({
    client: { async query() { throw transportCause; } },
  });
  await assert.rejects(
    transportFailure.queryEvents({ query: { MoveEventType: '0x1::m::E' } }),
    (error) => error.code === 'SUI_GRAPHQL_EVENT_QUERY_FAILED'
      && error.cause === transportCause,
  );

  const malformed = createGraphqlMoveEventAdapter({
    client: { async query() { return { data: { events: { nodes: null } } }; } },
  });
  await assert.rejects(
    malformed.queryEvents({ query: { MoveEventType: '0x1::m::E' } }),
    (error) => error.code === 'SUI_GRAPHQL_EVENT_RESPONSE_INVALID',
  );
});

test('GraphQL Move-event adapter fails closed on a non-progressing backward cursor', async () => {
  const adapter = createGraphqlMoveEventAdapter({
    client: {
      async query() {
        return {
          data: {
            events: {
              pageInfo: { hasPreviousPage: true, startCursor: 'same-cursor' },
              nodes: [],
            },
          },
        };
      },
    },
  });

  await assert.rejects(
    adapter.queryEvents({
      query: { MoveEventType: '0x1::m::E' },
      cursor: 'same-cursor',
      limit: 1,
    }),
    (error) => error.code === 'SUI_GRAPHQL_EVENT_CURSOR_STALLED',
  );
});

test('GraphQL Move-event adapter rejects unsupported queryEvents shapes before I/O', async () => {
  let calls = 0;
  const adapter = createGraphqlMoveEventAdapter({
    client: { async query() { calls += 1; } },
  });

  await assert.rejects(
    adapter.queryEvents({ query: { Sender: '0x1' } }),
    /MoveEventType/,
  );
  await assert.rejects(
    adapter.queryEvents({ query: { MoveEventType: '0x1::m::E' }, order: 'ascending' }),
    /descending order only/,
  );
  await assert.rejects(
    adapter.queryEvents({ query: { MoveEventType: '0x1::m::E' }, cursor: {} }),
    /cursor/,
  );
  await assert.rejects(
    adapter.queryEvents({ query: { MoveEventType: '0x1::m::E' }, limit: 0 }),
    /positive safe integer/,
  );
  assert.equal(calls, 0);
});
