// Writes the hand-authored draw.io fixtures for drawio.test.mjs (k33bz fork). No deps.
//   node catalog/aws-kit/import/fixtures/make-fixtures.mjs
// order-intake.drawio   plain mxfile: a colored custom container, a non-AWS box, an ellipse, a sticky note,
//                       an edge label child, a floating edge, numbered badges and a description column
// embed.drawio.svg      a .drawio.svg: the compressed mxfile in the root's content attribute
// embed.drawio.png      a .drawio.png: a small PNG whose zTXt chunk "mxfile" holds the URI-encoded mxfile
// (three-tier.drawio and three-tier.compressed.drawio come from the interop evaluation, written the way
// draw.io writes files: layers, a hidden layer, <object> labels, parent-relative geometry.)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TILE = (res, fill) => `sketch=0;outlineConnect=0;fontColor=#232F3E;fillColor=${fill};strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.${res};`;
const SHAPE = (shape, fill) => `sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=${fill};strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.${shape};`;
const EDGE = 'edgeStyle=orthogonalEdgeStyle;html=1;endArrow=open;endFill=0;strokeColor=#545B64;strokeWidth=2;rounded=0;';
const BADGE = 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#232F3E;strokeColor=none;fontColor=#FFFFFF;fontStyle=1;fontSize=12;';
const v = (id, value, style, x, y, w, h, parent = '1') => `<mxCell id="${id}" value="${esc(value)}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const e = (id, value, style, src, tgt, inner = '') => `<mxCell id="${id}" value="${esc(value)}" style="${style}" edge="1" parent="1"${src ? ` source="${src}"` : ''}${tgt ? ` target="${tgt}"` : ''}><mxGeometry relative="1" as="geometry">${inner}</mxGeometry></mxCell>`;
const model = (cells) => `<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1100" pageHeight="700" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel>`;
const mxfile = (name, m, compress = false) => `<mxfile host="app.diagrams.net" agent="fixture" version="27.0.0" type="device"><diagram id="p1" name="${esc(name)}">${compress ? zlib.deflateRawSync(Buffer.from(encodeURIComponent(m))).toString('base64') : m}</diagram></mxfile>\n`;

// ---- order-intake.drawio
const order = model([
  v('title', 'Order intake', 'text;html=1;align=left;verticalAlign=middle;fontSize=20;fontStyle=1;strokeColor=none;fillColor=none;', 40, 10, 300, 30),
  v('users', 'Shoppers', SHAPE('users', '#232F3D'), 40, 200, 48, 48),
  // a colored custom container (no AWS group style): kit gen frame with the compute tone and a tint
  v('svc', 'Order service', 'rounded=0;whiteSpace=wrap;html=1;container=1;collapsible=0;fillColor=#FFF5EB;strokeColor=#ED7100;verticalAlign=top;align=left;spacingLeft=8;fontColor=#ED7100;dashed=0;', 160, 120, 380, 200),
  v('apigw', 'Amazon API Gateway', TILE('api_gateway', '#E7157B'), 50, 80, 48, 48, 'svc'),
  v('fn', 'Order handler', TILE('lambda', '#ED7100'), 250, 80, 48, 48, 'svc'),
  v('ddb', 'Amazon DynamoDB', TILE('dynamodb', '#C925D1'), 680, 200, 48, 48),
  // non-AWS shapes: a box, an ellipse and a sticky note
  v('psp', 'Payment provider (SaaS)', 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;fontColor=#333333;', 650, 380, 140, 50),
  v('partner', 'Partner feed', 'ellipse;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;', 40, 400, 110, 50),
  v('sticky', 'Idempotency key per order', 'shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=10;', 330, 400, 130, 40),
  e('e1', 'HTTPS', EDGE, 'users', 'apigw'),
  e('e2', '', EDGE, 'apigw', 'fn'),
  e('e3', '', EDGE, 'fn', 'ddb'),
  `<mxCell id="e3-label" value="PutItem" style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];" vertex="1" connectable="0" parent="e3"><mxGeometry x="0.3" y="-10" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry></mxCell>`,
  e('e4', 'charge', `${EDGE}dashed=1;`, 'fn', 'psp', '<Array as="points"><mxPoint x="434" y="405"/></Array>'),
  // a floating edge: no source cell, a free start point and a waypoint
  e('e5', 'batch upload', EDGE, null, 'apigw', '<mxPoint x="95" y="400" as="sourcePoint"/><Array as="points"><mxPoint x="95" y="350"/><mxPoint x="234" y="350"/></Array>'),
  // badges on the wires, and the same numbers in a description column with their text
  v('b1', '1', BADGE, 112, 196, 24, 24),
  v('b2', '2', BADGE, 312, 196, 24, 24),
  v('b3', '3', BADGE, 590, 196, 24, 24),
  v('d1', '1', BADGE, 860, 120, 24, 24),
  v('t1', 'Shoppers submit an order to the API over HTTPS.', 'text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;fontSize=12;', 892, 118, 180, 40),
  v('d2', '2', BADGE, 860, 180, 24, 24),
  v('t2', 'API Gateway invokes the order handler with the validated request.', 'text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;fontSize=12;', 892, 178, 180, 50),
  v('d3', '3', BADGE, 860, 250, 24, 24),
  v('t3', 'The handler writes the order to DynamoDB once, keyed by the idempotency key.', 'text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;fontSize=12;', 892, 248, 180, 60),
  v('cap', 'Orders are written once', 'text;html=1;align=center;verticalAlign=middle;fontSize=11;fontColor=#545B64;strokeColor=none;fillColor=none;', 600, 280, 160, 20),
]);
export const ORDER = mxfile('Order intake', order);

// ---- a small two-tier diagram for the embedded formats
const small = model([
  v('cloud', 'AWS Cloud', 'points=[[0,0],[1,1]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;container=1;pointerEvents=0;collapsible=0;recursiveResize=0;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_aws_cloud_alt;strokeColor=#232F3E;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#232F3E;dashed=0;', 120, 20, 420, 200),
  v('client', 'Client', SHAPE('client', '#232F3D'), 30, 96, 48, 48),
  v('cf', 'Amazon CloudFront', TILE('cloudfront', '#8C4FFF'), 60, 76, 48, 48, 'cloud'),
  v('bucket', 'Site bucket', SHAPE('bucket', '#7AA116'), 300, 76, 48, 48, 'cloud'),
  e('a', 'HTTPS', EDGE, 'client', 'cf'),
  e('b', 'origin fetch', `${EDGE}dashed=1;`, 'cf', 'bucket'),
]);
export const SMALL = mxfile('Static site', small, true);

// .drawio.svg: draw.io stores the (compressed) mxfile, XML-escaped, in the root's content attribute
export const SVG = (
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="561px" height="241px" viewBox="-0.5 -0.5 561 241" content="${esc(SMALL.trim())}"><defs/><g><rect x="120" y="20" width="420" height="200" fill="none" stroke="#232f3e"/><text x="150" y="36" font-family="Helvetica" font-size="12">AWS Cloud</text></g></svg>\n`);

// .drawio.png: a 4x4 PNG with the diagram in a text chunk named mxfile (URI-encoded XML; draw.io writes tEXt,
// the fixture uses zTXt and the tests build the tEXt form)
const crc = (buf) => zlib.crc32(buf);
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td) >>> 0);
  return Buffer.concat([len, td, c]);
};
export function png(text, type = 'zTXt') {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(4 * (1 + 4 * 3), 0xff); for (let y = 0; y < 4; y++) raw[y * 13] = 0;
  const payload = Buffer.from(encodeURIComponent(text), 'latin1');
  const txt = type === 'zTXt' ? Buffer.concat([Buffer.from('mxfile\0', 'latin1'), Buffer.from([0]), zlib.deflateSync(payload)]) : Buffer.concat([Buffer.from('mxfile\0', 'latin1'), payload]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk(type, txt), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(HERE, 'order-intake.drawio'), ORDER);
  fs.writeFileSync(path.join(HERE, 'embed.drawio.svg'), SVG);
  fs.writeFileSync(path.join(HERE, 'embed.drawio.png'), png(SMALL));
  console.log('wrote order-intake.drawio, embed.drawio.svg, embed.drawio.png');
}
