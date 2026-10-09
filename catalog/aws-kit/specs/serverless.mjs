// Serverless family for the AWS Architecture gallery (k33bz fork).
//   node catalog/aws-kit/awd.mjs preview catalog/aws-kit/specs/serverless.mjs [light]
//   node catalog/aws-kit/awd.mjs build   catalog/aws-kit/specs/serverless.mjs
//
// Conventions: icons are 40px (32px for resource icons) and are placed by CENTER with N(); step
// badges ride on or just above wires, and the API call names are wire labels below them; each
// diagram has one clock (`dur`). Tile order pairs the four normal-width diagrams, then the wide ones.

// node by center point
const N = (id, icon, cx, cy, label, o = {}) => {
  const s = o.size || 40;
  return { id, icon, x: cx - s / 2, y: cy - s / 2, label, ...o };
};
// fraction along an M/H/V wire path at the point (x, y) on it: puts a wire label (labelAt) exactly
// where the caption it names belongs
const fAt = (d, x, y) => {
  const p = [...d.matchAll(/([MHV])\s*([-\d.]+)(?:,([-\d.]+))?/g)].reduce((a, [, c, u, v]) => {
    const [px, py] = a.length ? a[a.length - 1] : [0, 0];
    a.push(c === 'M' ? [+u, +v] : c === 'H' ? [+u, py] : [px, +u]); return a;
  }, []);
  const seg = p.slice(1).map((q, i) => Math.hypot(q[0] - p[i][0], q[1] - p[i][1]));
  const tot = seg.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < seg.length; i++) {
    const [a, b] = [p[i], p[i + 1]];
    if (Math.min(a[0], b[0]) <= x && x <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= y && y <= Math.max(a[1], b[1])) return +((acc + Math.hypot(x - a[0], y - a[1])) / tot).toFixed(4);
    acc += seg[i];
  }
  throw new Error(`(${x}, ${y}) is not on ${d}`);
};

export default {
  section: { id: 'serverless', title: 'SERVERLESS' },
  diagrams: [
    // ------------------------------------------------------------------ sl-api
    {
      id: 'sl-api',
      name: 'Serverless REST API',
      aria: 'Serverless REST API: Users call Amazon API Gateway, which invokes AWS Lambda, which reads and writes Amazon DynamoDB; API Gateway and Lambda send logs and metrics to Amazon CloudWatch.',
      desc: 'Users call an Amazon API Gateway REST API, which invokes an AWS Lambda function that reads and writes an Amazon DynamoDB table. Request packets run left to right, responses return the same way, and packets on the dashed wires send logs and metrics to Amazon CloudWatch.',
      w: 480, h: 270, dur: 8,
      groups: [
        { kind: 'cloud', x: 84, y: 8, w: 388, h: 254 },
        { kind: 'region', x: 100, y: 38, w: 356, h: 212 },
      ],
      nodes: [
        N('users', 'aws-res-users', 38, 96, 'Users'),
        N('apigw', 'aws-svc-api-gateway', 160, 96, 'Amazon API Gateway', { sub: 'REST API' }),
        N('fn', 'aws-svc-lambda', 278, 96, 'AWS Lambda'),
        N('ddb', 'aws-svc-dynamodb', 396, 96, 'Amazon DynamoDB'),
        N('cw', 'aws-svc-cloudwatch', 219, 192, 'Amazon CloudWatch', { wrap: 18, sub: 'logs and metrics' }),
      ],
      wires: [
        { id: 'p1', from: 'users', to: 'apigw', both: true },
        { id: 'p2', from: 'apigw', to: 'fn', both: true },
        { id: 'p3', from: 'fn', to: 'ddb', both: true },
        { id: 'l1', d: 'M160,158 V192 H195', dashed: true },
        { id: 'l2', d: 'M278,137 V192 H243', dashed: true },
      ],
      steps: [
        { n: 1, at: 'p1', f: 0.76, text: 'Users send requests to the REST API in Amazon API Gateway.' },
        { n: 2, at: 'p2', text: 'Amazon API Gateway invokes the AWS Lambda function with the request.' },
        { n: 3, at: 'p3', text: 'AWS Lambda reads and writes items in Amazon DynamoDB, and the response returns to users. API Gateway and Lambda send logs and metrics to Amazon CloudWatch.' },
      ],
      timeline: [
        { wire: 'p1', t: [0.04, 0.13], ring: 'apigw' },
        { wire: 'p2', t: [0.15, 0.24], ring: 'fn' },
        { wire: 'p3', t: [0.26, 0.35], ring: 'ddb' },
        { wire: 'l2', t: [0.28, 0.38], kind: 'pk-2', ring: 'cw' },
        { wire: 'p3', t: [0.42, 0.50], reverse: true, kind: 'pk-2', ring: 'fn' },
        { wire: 'p2', t: [0.52, 0.60], reverse: true, kind: 'pk-2', ring: 'apigw' },
        { wire: 'p1', t: [0.62, 0.71], reverse: true, kind: 'pk-2', ring: 'users' },
        { wire: 'l1', t: [0.74, 0.84], kind: 'pk-2', ring: 'cw' },
      ],
    },

    // ------------------------------------------------------------------ sl-auth
    {
      id: 'sl-auth',
      name: 'Authenticated API with Amazon Cognito',
      aria: 'Authenticated API: Users sign in to an Amazon Cognito user pool and get tokens, then call Amazon API Gateway, which validates the token with Cognito before invoking AWS Lambda and Amazon DynamoDB.',
      desc: 'Users sign in to an Amazon Cognito user pool and receive tokens, then call API Gateway with the token. A Cognito authorizer validates it before Lambda runs and reads DynamoDB. Packets show sign-in, token validation, the request and the response.',
      w: 480, h: 284, dur: 10,
      groups: [
        { kind: 'cloud', x: 84, y: 8, w: 388, h: 268 },
        { kind: 'region', x: 100, y: 38, w: 356, h: 226 },
      ],
      nodes: [
        N('users', 'aws-res-users', 38, 204, 'Users'),
        N('cog', 'aws-svc-cognito', 160, 82, 'Amazon Cognito', { sub: 'user pool' }),
        N('apigw', 'aws-svc-api-gateway', 160, 204, 'Amazon API Gateway'),
        N('fn', 'aws-svc-lambda', 278, 204, 'AWS Lambda'),
        N('ddb', 'aws-svc-dynamodb', 396, 204, 'Amazon DynamoDB'),
      ],
      wires: [
        { id: 'signin', d: 'M38,180 V82 H136', both: true },
        { id: 'call', from: 'users', to: 'apigw', both: true },
        { id: 'auth', d: 'M160,180 V132', dashed: true, both: true, label: 'Cognito authorizer validates token', labelDx: 11, labelDy: 3, labelAnchor: 'start' },
        { id: 'p3', from: 'apigw', to: 'fn' },
        { id: 'p4', from: 'fn', to: 'ddb' },
      ],
      steps: [
        { n: 1, at: 'signin', f: 0.26, dx: 13, dy: 0, text: 'Users sign in to the Amazon Cognito user pool and receive tokens.' },
        { n: 2, at: 'call', f: 0.76, text: 'Users call Amazon API Gateway and send the token with the request.' },
        { n: 3, at: 'auth', f: 0.5, dx: -13, dy: 0, text: 'Amazon API Gateway validates the token with its Amazon Cognito authorizer against the user pool.' },
        { n: 4, at: 'p3', text: 'Amazon API Gateway invokes the AWS Lambda function only after the token is valid.' },
        { n: 5, at: 'p4', text: 'AWS Lambda reads Amazon DynamoDB, and the response returns to users through API Gateway.' },
      ],
      timeline: [
        { wire: 'signin', t: [0.03, 0.13], ring: 'cog' },
        { wire: 'signin', t: [0.14, 0.24], reverse: true, kind: 'pk-2', ring: 'users' },
        { wire: 'call', t: [0.27, 0.34], ring: 'apigw' },
        { wire: 'auth', t: [0.36, 0.42], ring: 'cog' },
        { wire: 'auth', t: [0.43, 0.49], reverse: true, kind: 'pk-2', ring: 'apigw' },
        { wire: 'p3', t: [0.52, 0.59], ring: 'fn' },
        { wire: 'p4', t: [0.60, 0.67], ring: 'ddb' },
        { wire: 'p4', t: [0.71, 0.77], reverse: true, kind: 'pk-2', ring: 'fn' },
        { wire: 'p3', t: [0.78, 0.84], reverse: true, kind: 'pk-2', ring: 'apigw' },
        { wire: 'call', t: [0.85, 0.93], reverse: true, kind: 'pk-2', ring: 'users' },
      ],
    },

    // ------------------------------------------------------------------ sl-s3-events
    {
      id: 'sl-s3-events',
      name: 'S3 event-driven processing',
      aria: 'S3 event-driven processing: an upload to an Amazon S3 source bucket triggers AWS Lambda, which writes to a destination bucket and records metadata in Amazon DynamoDB.',
      desc: 'An object uploaded to an Amazon S3 bucket sends an event notification that invokes AWS Lambda. The function writes its output to a second bucket, so it cannot retrigger itself, and records metadata in Amazon DynamoDB.',
      w: 480, h: 282, dur: 6,
      groups: [
        { kind: 'cloud', x: 84, y: 8, w: 388, h: 266 },
        { kind: 'region', x: 100, y: 38, w: 356, h: 224 },
      ],
      nodes: [
        N('users', 'aws-res-users', 38, 136, 'Users'),
        N('src', 'aws-svc-simple-storage-service', 160, 136, 'Amazon S3', { sub: 'source bucket' }),
        N('fn', 'aws-svc-lambda', 278, 136, 'AWS Lambda', { sub: 'resize image' }),
        N('dst', 'aws-svc-simple-storage-service', 396, 82, 'Amazon S3', { sub: 'destination bucket' }),
        N('ddb', 'aws-svc-dynamodb', 396, 190, 'Amazon DynamoDB', { sub: 'metadata table' }),
      ],
      wires: [
        { id: 'up', from: 'users', to: 'src' },
        { id: 'ev', from: 'src', to: 'fn', dashed: true, label: 'event', labelAt: 0.72 },
        { id: 'o1', from: 'fn', to: 'dst', via: 336 },
        { id: 'o2', from: 'fn', to: 'ddb', via: 336 },
      ],
      steps: [
        { n: 1, at: 'up', f: 0.76, text: 'Users upload an object to the Amazon S3 source bucket.' },
        { n: 2, at: 'ev', f: 0.25, text: 'Amazon S3 sends an event notification that invokes the AWS Lambda function.' },
        { n: 3, at: 'o1', f: 0.86, text: 'AWS Lambda resizes the image and writes the result to the destination bucket, so the function does not trigger itself again.' },
        { n: 4, at: 'o2', f: 0.86, text: 'AWS Lambda records the image metadata in the Amazon DynamoDB table.' },
      ],
      timeline: [
        { wire: 'up', t: [0.06, 0.22], ring: 'src' },
        { wire: 'ev', t: [0.27, 0.43], ring: 'fn' },
        { wire: 'o1', t: [0.49, 0.67], ring: 'dst' },
        { wire: 'o2', t: [0.49, 0.67], ring: 'ddb' },
      ],
    },

    // ------------------------------------------------------------------ sl-ws
    {
      id: 'sl-ws',
      name: 'WebSocket API with API Gateway',
      aria: 'WebSocket API: clients connect to an Amazon API Gateway WebSocket API that routes messages to AWS Lambda, which keeps connection IDs in Amazon DynamoDB and posts back through API Gateway to every client.',
      desc: 'Clients keep WebSocket connections open to an Amazon API Gateway WebSocket API. A message is routed to AWS Lambda, which looks up connection IDs in Amazon DynamoDB and pushes the message back through the API Gateway management API to every connected client.',
      w: 480, h: 286, dur: 7,
      groups: [
        { kind: 'cloud', x: 72, y: 8, w: 400, h: 270 },
        { kind: 'region', x: 88, y: 38, w: 372, h: 228 },
      ],
      nodes: [
        N('ca', 'aws-res-client', 34, 70, 'Client'),
        N('cb', 'aws-res-mobile-client', 34, 206, 'Mobile client', { wrap: 8 }),
        N('apigw', 'aws-svc-api-gateway', 156, 138, 'Amazon API Gateway', { sub: 'WebSocket API' }),
        N('fn', 'aws-svc-lambda', 276, 138, 'AWS Lambda'),
        N('ddb', 'aws-svc-dynamodb', 396, 138, 'Amazon DynamoDB', { sub: 'connections table' }),
      ],
      wires: [
        { id: 'c1', d: 'M56,70 H108 V128 H132', both: true },
        { id: 'c2', d: 'M56,206 H108 V148 H132', both: true },
        { id: 'rt', from: 'apigw', to: 'fn', label: 'route', labelDx: 11, labelDy: -8 },
        // the management API call: Lambda posts back to API Gateway, which pushes to the clients
        { id: 'cn', d: 'M276,114 V96 H156 V114', dashed: true, label: '@connections', labelAt: fAt('M276,114 V96 H156 V114', 190, 96) },
        { id: 'db', from: 'fn', to: 'ddb', both: true },
      ],
      steps: [
        { n: 1, at: 'c1', f: 0.62, dy: 0, text: 'Clients keep WebSocket connections open to the Amazon API Gateway WebSocket API and send messages over them.' },
        { n: 1, at: 'c2', f: 0.62, dy: 0 },
        { n: 2, at: 'rt', f: 0.2, dy: 0, text: 'Amazon API Gateway routes each message to the AWS Lambda function.' },
        { n: 3, at: 'db', f: 0.5, text: 'AWS Lambda reads the open connection IDs from the Amazon DynamoDB connections table.' },
        { n: 4, at: 'cn', f: 0.3, dy: 0, text: 'AWS Lambda posts the message to each connection through the @connections API, and API Gateway pushes it to every connected client.' },
      ],
      timeline: [
        { wire: 'c1', t: [0.05, 0.14], ring: 'apigw' },
        { wire: 'rt', t: [0.17, 0.25], ring: 'fn' },
        { wire: 'db', t: [0.28, 0.36], ring: 'ddb' },
        { wire: 'db', t: [0.38, 0.46], reverse: true, kind: 'pk-2', ring: 'fn' },
        { wire: 'cn', t: [0.50, 0.60], ring: 'apigw' },
        { wire: 'c1', t: [0.64, 0.74], reverse: true, kind: 'pk-2', ring: 'ca' },
        { wire: 'c2', t: [0.64, 0.74], reverse: true, kind: 'pk-2', ring: 'cb' },
      ],
    },

    // ------------------------------------------------------------------ sl-sfn
    {
      id: 'sl-sfn',
      name: 'AWS Step Functions orchestration',
      aria: 'Step Functions orchestration: Amazon API Gateway starts an AWS Step Functions state machine that runs a Lambda task, a Parallel state with two Lambda tasks, then publishes to Amazon SNS email subscribers.',
      wide: true,
      desc: 'Amazon API Gateway starts an AWS Step Functions state machine that runs a Lambda task, then two Lambda tasks in a Parallel state, then publishes to Amazon SNS. The caller gets the execution back right away while the packets follow the workflow.',
      w: 960, h: 332, dur: 9,
      groups: [
        { kind: 'cloud', x: 88, y: 8, w: 852, h: 316 },
        { kind: 'region', x: 104, y: 38, w: 820, h: 274 },
        { kind: 'gen', x: 372, y: 66, w: 434, h: 232, label: 'State machine' },
        { kind: 'gen', x: 523, y: 94, w: 146, h: 190, label: 'Parallel' },
      ],
      nodes: [
        N('users', 'aws-res-users', 34, 181, 'Users'),
        N('apigw', 'aws-svc-api-gateway', 170, 181, 'Amazon API Gateway'),
        N('sfn', 'aws-svc-step-functions', 310, 181, 'AWS Step Functions'),
        N('val', 'aws-svc-lambda', 440, 181, 'AWS Lambda', { sub: 'validate order' }),
        N('pa', 'aws-svc-lambda', 596, 138, 'AWS Lambda', { sub: 'process payment' }),
        N('pb', 'aws-svc-lambda', 596, 224, 'AWS Lambda', { sub: 'reserve inventory' }),
        N('sns', 'aws-svc-simple-notification-service', 756, 181, 'Amazon SNS', { sub: 'order topic' }),
        N('mail', 'aws-res-simple-notification-service-email-notification', 872, 181, 'Email', { sub: 'subscribers' }),
      ],
      wires: [
        { id: 'w1', from: 'users', to: 'apigw', both: true },
        { id: 'w2', from: 'apigw', to: 'sfn', both: true, label: 'StartExecution', labelDy: 14 },
        { id: 'w3', from: 'sfn', to: 'val' },
        { id: 'fa', from: 'val', to: 'pa', via: 492 },
        { id: 'fb', from: 'val', to: 'pb', via: 492 },
        { id: 'ja', from: 'pa', to: 'sns', via: 700 },
        { id: 'jb', from: 'pb', to: 'sns', via: 700 },
        { id: 'w7', from: 'sns', to: 'mail' },
      ],
      steps: [
        { n: 1, at: 'w1', f: 0.8, text: 'Users submit an order through Amazon API Gateway.' },
        { n: 2, at: 'w2', f: 0.2, text: 'Amazon API Gateway calls StartExecution on AWS Step Functions and returns the execution ARN to the caller right away.' },
        { n: 3, at: 'w3', f: 0.2, text: 'AWS Step Functions runs the first task, an AWS Lambda function that validates the order.' },
        { n: 4, at: 'fa', f: 0.82, text: 'AWS Step Functions runs two AWS Lambda tasks in a Parallel state: process payment and reserve inventory.' },
        { n: 5, at: 'ja', f: 0.9, text: 'AWS Step Functions publishes to the Amazon SNS order topic after both branches finish.' },
        { n: 6, at: 'w7', f: 0.62, text: 'Amazon SNS sends an email notification to the topic subscribers.' },
      ],
      timeline: [
        { wire: 'w1', t: [0.03, 0.10], ring: 'apigw' },
        { wire: 'w2', t: [0.11, 0.18], ring: 'sfn' },
        { wire: 'w3', t: [0.20, 0.28], ring: 'val' },
        { wire: 'w2', t: [0.20, 0.28], reverse: true, kind: 'pk-2', ring: 'apigw' },
        { wire: 'w1', t: [0.29, 0.37], reverse: true, kind: 'pk-2', ring: 'users' },
        { wire: 'fa', t: [0.40, 0.50], ring: 'pa' },
        { wire: 'fb', t: [0.40, 0.50], ring: 'pb' },
        { wire: 'ja', t: [0.55, 0.65], ring: 'sns' },
        { wire: 'jb', t: [0.55, 0.65] },
        { wire: 'w7', t: [0.70, 0.79], ring: 'mail' },
      ],
    },

    // ------------------------------------------------------------------ sl-eventbridge
    {
      id: 'sl-eventbridge',
      name: 'Event fan-out with Amazon EventBridge',
      aria: 'Event fan-out: producers put events on an Amazon EventBridge event bus, and three rules route each event to AWS Lambda, Amazon SQS and AWS Step Functions targets.',
      wide: true,
      desc: 'Producers put events on an Amazon EventBridge event bus. Three rules match the event and route it to an AWS Lambda function, an Amazon SQS queue and an AWS Step Functions state machine, so one event fans out to all three targets.',
      w: 960, h: 336, dur: 6,
      groups: [
        { kind: 'cloud', x: 104, y: 8, w: 816, h: 320 },
        { kind: 'region', x: 120, y: 38, w: 784, h: 278 },
      ],
      nodes: [
        N('p1', 'aws-res-generic-application', 42, 130, 'Producer', { sub: 'orders service' }),
        N('p2', 'aws-res-generic-application', 42, 214, 'Producer', { sub: 'checkout service' }),
        N('bus', 'aws-svc-eventbridge', 262, 172, 'Amazon EventBridge', { wrap: 18, sub: 'custom event bus' }),
        N('r1', 'aws-res-eventbridge-rule', 548, 88, 'Rule', { size: 32, sub: 'detail-type: OrderPlaced' }),
        N('r2', 'aws-res-eventbridge-rule', 548, 172, 'Rule', { size: 32, sub: 'source: app.orders' }),
        N('r3', 'aws-res-eventbridge-rule', 548, 256, 'Rule', { size: 32, sub: 'detail.total > 100' }),
        N('t1', 'aws-svc-lambda', 830, 88, 'AWS Lambda', { sub: 'fulfillment' }),
        N('t2', 'aws-svc-simple-queue-service', 830, 172, 'Amazon SQS', { sub: 'analytics queue' }),
        N('t3', 'aws-svc-step-functions', 830, 256, 'AWS Step Functions', { wrap: 18, sub: 'billing workflow' }),
      ],
      wires: [
        { id: 'e1', d: 'M64,130 H170 V172 H238' },
        { id: 'e2', d: 'M64,214 H170 V172 H238', label: 'PutEvents', labelAt: fAt('M64,214 H170 V172 H238', 204, 172), labelDy: 14 },
        { id: 'f1', from: 'bus', to: 'r1', via: 400 },
        { id: 'f2', from: 'bus', to: 'r2' },
        { id: 'f3', from: 'bus', to: 'r3', via: 400 },
        { id: 'g1', from: 'r1', to: 't1', label: 'Invoke', labelDy: 14 },
        { id: 'g2', from: 'r2', to: 't2', label: 'SendMessage', labelDy: 14 },
        { id: 'g3', from: 'r3', to: 't3', label: 'StartExecution', labelDy: 14 },
      ],
      steps: [
        { n: 1, at: 'e1', f: 0.9, text: 'Producers send events to the Amazon EventBridge custom event bus with PutEvents.' },
        { n: 2, at: 'f2', f: 0.35, text: 'Amazon EventBridge matches each event against the event pattern of every rule on the bus.' },
        { n: 3, at: 'g1', f: 0.2, text: 'Each matching rule sends the event to its target: an AWS Lambda function, an Amazon SQS queue and an AWS Step Functions state machine.' },
        { n: 3, at: 'g2', f: 0.2 },
        { n: 3, at: 'g3', f: 0.2 },
      ],
      timeline: [
        { wire: 'e1', t: [0.06, 0.20] },
        { wire: 'e2', t: [0.06, 0.20], ring: 'bus' },
        { wire: 'f1', t: [0.26, 0.42], ring: 'r1' },
        { wire: 'f2', t: [0.26, 0.42], ring: 'r2' },
        { wire: 'f3', t: [0.26, 0.42], ring: 'r3' },
        { wire: 'g1', t: [0.48, 0.68], ring: 't1' },
        { wire: 'g2', t: [0.48, 0.68], ring: 't2' },
        { wire: 'g3', t: [0.48, 0.68], ring: 't3' },
      ],
    },

    // ------------------------------------------------------------------ sl-queue
    {
      id: 'sl-queue',
      name: 'Queue-based load leveling',
      aria: 'Queue-based load leveling: Amazon API Gateway sends requests to an Amazon SQS queue, AWS Lambda consumers scale out to write Amazon DynamoDB, and failed messages move to a dead-letter queue.',
      wide: true,
      desc: 'Amazon API Gateway writes each request to an Amazon SQS queue, so a burst is absorbed instead of hitting the database. AWS Lambda consumers scale out with the queue, extra copies light up in their dim slots during the burst, and a dead-letter queue collects messages that keep failing (red packets).',
      w: 960, h: 387, dur: 10,
      groups: [
        { kind: 'cloud', x: 116, y: 8, w: 790, h: 371 },
        { kind: 'region', x: 132, y: 34, w: 758, h: 333 },
        { kind: 'gen', x: 582, y: 52, w: 140, h: 299, label: 'Concurrent executions' },
      ],
      nodes: [
        N('users', 'aws-res-users', 60, 204, 'Users'),
        N('apigw', 'aws-svc-api-gateway', 248, 204, 'Amazon API Gateway'),
        N('sqs', 'aws-svc-simple-queue-service', 436, 204, 'Amazon SQS'),
        N('l2', 'aws-svc-lambda', 652, 104, 'AWS Lambda'),
        N('l1', 'aws-svc-lambda', 652, 204, 'AWS Lambda'),
        N('l3', 'aws-svc-lambda', 652, 304, 'AWS Lambda'),
        N('ddb', 'aws-svc-dynamodb', 842, 204, 'Amazon DynamoDB'),
        N('dlq', 'aws-svc-simple-queue-service', 436, 304, 'Amazon SQS', { sub: 'dead-letter queue' }),
      ],
      wires: [
        { id: 'u', from: 'users', to: 'apigw', both: true },
        { id: 's', from: 'apigw', to: 'sqs', label: 'SendMessage', labelDy: 14 },
        { id: 'c', d: 'M458,204 H578', label: 'event source mapping', labelDy: 14 },
        { id: 'd', d: 'M724,204 H818', label: 'PutItem', labelDy: 14 },
        { id: 'dlq', d: 'M436,245 V280', dashed: true, hot: true, label: 'maxReceiveCount', labelDx: -12, labelDy: 3.5, labelAnchor: 'end' },
      ],
      steps: [
        { n: 1, at: 'u', f: 0.68, text: 'Users send a burst of requests to Amazon API Gateway.' },
        { n: 2, at: 's', text: 'Amazon API Gateway writes each request to the Amazon SQS queue with SendMessage and responds right away, so the burst waits in the queue.' },
        { n: 3, at: 'c', text: 'AWS Lambda polls the queue through an event source mapping and scales out concurrent executions as messages build up.' },
        { n: 4, at: 'd', text: 'AWS Lambda writes each message to Amazon DynamoDB with PutItem.' },
        { n: 5, at: 'dlq', f: 0.5, dx: 13, dy: 0, text: 'Amazon SQS moves a message to the dead-letter queue after it is received more than maxReceiveCount times.' },
      ],
      timeline: [
        // a burst of three requests, absorbed by the queue; the API answers right away
        { wire: 'u', t: [0.02, 0.07] },
        { wire: 'u', t: [0.04, 0.09] },
        { wire: 'u', t: [0.06, 0.11], ring: 'apigw' },
        { wire: 's', t: [0.09, 0.14] },
        { wire: 's', t: [0.11, 0.16] },
        { wire: 's', t: [0.13, 0.18], ring: 'sqs' },
        { wire: 'u', t: [0.19, 0.26], reverse: true, kind: 'pk-2', ring: 'users' },
        // one consumer picks up first, then the pool scales out and drains the queue
        { wire: 'c', t: [0.28, 0.36], ring: 'l1' },
        { wire: 'c', t: [0.40, 0.47], ring: 'l2' },
        { wire: 'c', t: [0.42, 0.49], ring: 'l3' },
        { wire: 'c', t: [0.44, 0.51], ring: 'l1' },
        { wire: 'd', t: [0.55, 0.62] },
        { wire: 'd', t: [0.57, 0.64] },
        { wire: 'd', t: [0.59, 0.66], ring: 'ddb' },
        // a message that keeps failing is moved to the dead-letter queue
        { wire: 'dlq', t: [0.70, 0.78], kind: 'pk-bad', ring: 'dlq' },
      ],
      effects: [
        { appear: 'l2', t: [0.34, 0.84], ghost: true },
        { appear: 'l3', t: [0.36, 0.84], ghost: true },
      ],
    },

    // ------------------------------------------------------------------ sl-static
    {
      id: 'sl-static',
      name: 'Static website plus API with CloudFront',
      aria: 'Static website plus API: Amazon Route 53 resolves to Amazon CloudFront, whose default behavior serves a static site from Amazon S3 and whose /api/* behavior goes to Amazon API Gateway and AWS Lambda.',
      wide: true,
      desc: 'Amazon Route 53 resolves the domain to an Amazon CloudFront distribution with two behaviors: the default behavior serves a static site from Amazon S3, and /api/* goes to Amazon API Gateway and AWS Lambda. Packets show a DNS lookup, then a page load that sends a static request and an API request together.',
      w: 960, h: 369, dur: 10,
      groups: [
        { kind: 'cloud', x: 126, y: 8, w: 762, h: 353 },
        { kind: 'region', x: 520, y: 34, w: 352, h: 315 },
      ],
      nodes: [
        N('users', 'aws-res-users', 70, 182, 'Users'),
        N('r53', 'aws-svc-route-53', 240, 86, 'Amazon Route 53', { wrap: 16 }),
        N('cf', 'aws-svc-cloudfront', 240, 182, 'Amazon CloudFront', { wrap: 18, sub: 'distribution' }),
        N('s3', 'aws-svc-simple-storage-service', 620, 86, 'Amazon S3', { sub: 'static site origin' }),
        N('apigw', 'aws-svc-api-gateway', 620, 278, 'Amazon API Gateway', { wrap: 18, sub: 'API origin' }),
        N('fn', 'aws-svc-lambda', 800, 278, 'AWS Lambda'),
      ],
      wires: [
        { id: 'dns', d: 'M70,158 V86 H216', dashed: true, both: true, label: 'DNS lookup', labelAt: fAt('M70,158 V86 H216', 165, 86), labelDy: 14 },
        { id: 'https', from: 'users', to: 'cf', both: true, label: 'HTTPS', labelAt: fAt('M92,182 H216', 165, 182), labelDy: 14 },
        { id: 'alias', d: 'M240,127 V158', dashed: true, label: 'alias record', labelDx: 8, labelDy: 3.5, labelAnchor: 'start' },
        { id: 'b1', d: 'M262,182 H340 V86 H596', both: true, label: 'Default (*) behavior', labelAt: fAt('M262,182 H340 V86 H596', 468, 86), labelDy: 14 },
        { id: 'b2', d: 'M262,182 H340 V278 H596', both: true, label: '/api/* behavior', labelAt: fAt('M262,182 H340 V278 H596', 468, 278), labelDy: 14 },
        { id: 'o', from: 'apigw', to: 'fn', both: true },
      ],
      steps: [
        { n: 1, at: 'dns', f: 0.3, dx: 13, dy: 0, text: 'Users look up the domain in Amazon Route 53, which answers with an alias record for the CloudFront distribution.' },
        { n: 2, at: 'https', f: 0.8, text: 'Users send HTTPS requests to the Amazon CloudFront distribution.' },
        { n: 3, at: 'b1', f: 0.6, text: 'Amazon CloudFront routes by path: the default (*) behavior goes to the Amazon S3 origin, and /api/* goes to the Amazon API Gateway origin.' },
        { n: 3, at: 'b2', f: 0.6 },
        { n: 4, at: 'o', text: 'Amazon API Gateway invokes AWS Lambda, and both responses return to users through CloudFront.' },
      ],
      timeline: [
        // DNS lookup first
        { wire: 'dns', t: [0.03, 0.11], ring: 'r53' },
        { wire: 'dns', t: [0.12, 0.20], reverse: true, kind: 'pk-2', ring: 'users' },
        // a page load sends two requests: the static page (default behavior) and an API call (/api/*)
        { wire: 'https', t: [0.24, 0.31], ring: 'cf' },
        { wire: 'https', t: [0.27, 0.34] },
        { wire: 'b1', t: [0.33, 0.45], ring: 's3' },
        { wire: 'b2', t: [0.36, 0.48], ring: 'apigw' },
        { wire: 'o', t: [0.50, 0.57], ring: 'fn' },
        { wire: 'b1', t: [0.47, 0.59], reverse: true, kind: 'pk-2', ring: 'cf' },
        { wire: 'o', t: [0.58, 0.65], reverse: true, kind: 'pk-2', ring: 'apigw' },
        { wire: 'https', t: [0.61, 0.68], reverse: true, kind: 'pk-2', ring: 'users' },
        { wire: 'b2', t: [0.66, 0.78], reverse: true, kind: 'pk-2', ring: 'cf' },
        { wire: 'https', t: [0.79, 0.87], reverse: true, kind: 'pk-2', ring: 'users' },
      ],
    },
  ],
};
