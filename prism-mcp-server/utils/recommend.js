// Intent to selection: reads a plain request ("a loading state that respects reduced motion", "show
// revenue over time next to the plan mix") and says which catalog facets answer it: role, dataShape,
// background, motion, JS, the AWS gallery and a theme. recommend_effects ranks the catalog with it.
//
// The words map to the derived selection metadata (catalog/selection-vocab.json): a role is what a
// component is for, a dataShape the data relationship a chart fits. Weak words (metric, region, flow)
// only count next to a chart word, so "a toast for a workflow" stays a feedback request.

import { designSystems } from './themes.js';

const CHART_CONTEXT = /\b(charts?|graphs?|plots?|visuali[sz]\w*|dashboards?|diagrams?|maps?|kpis?|metrics?|data|reports?|analytics)\b/;

// [shape, strong (alone is enough), weak (needs a chart word), why]
const SHAPES = [
  ['time-series', /\b(over time|time[- ]?series|trends?|history|historical|timelines?|sparklines?|line charts?|area charts?)\b/, /\b(daily|weekly|monthly|hourly|per (day|week|month|hour)|streaming|growth)\b/, 'a value changing over time: line, area, sparkline'],
  ['part-to-whole', /\b(part[- ]to[- ]whole|breakdown|composition|proportions?|percent(age)? of|pie|donut|doughnut|treemap|stacked 100)\b/, /\b(share|split|mix|allocation)\b/, 'shares of one total: donut, pie, stacked 100% bar, treemap'],
  ['comparison', /\b(compar(e|es|ing|ison)|versus|rank(ed|ing)?|leaderboard|bar charts?|column charts?|benchmark)\b/, /\b(vs|top \d+)\b/, 'values side by side: bars, columns, ranked lists'],
  ['distribution', /\b(distributions?|histograms?|percentiles?|box ?plots?|violin)\b/, /\b(spread|variance)\b/, 'how values spread: histogram, box plot'],
  ['correlation', /\b(correlat\w*|scatter( plot)?|bubble charts?|relationship between)\b/, null, 'two measures against each other: scatter, bubble'],
  ['flow', /\b(sankey|funnels?|flow charts?|flowcharts?|org charts?|hierarch\w*|network graphs?|data flow)\b/, /\b(flows?|pipelines?|journeys?|process|workflows?)\b/, 'movement or structure between steps: sankey, funnel, flow, tree'],
  ['geo', /\b(maps?|geo\w*|choropleth|world map)\b/, /\b(countr(y|ies)|regions?|regional|locations?|cit(y|ies))\b/, 'values on a place: map, choropleth'],
  ['single-value', /\b(kpis?|big numbers?|single (value|number|metric)|stat tiles?|scorecards?|gauges?)\b/, /\b(metric|counter|score|total)\b/, 'one headline number: KPI tile, big number, gauge'],
];

// [role, pattern, why]
const ROLES = [
  ['loading', /\b(load(ing|er|s)?|spinners?|skeletons?|progress( bars?| indicators?)?|busy|please wait|pending)\b/, 'waiting for content: spinner, skeleton, progress'],
  ['feedback', /\b(toasts?|alerts?|notifications?|notify|banners?|badges?|status(es)?|snackbars?|tooltips?|error messages?|success messages?|callouts?)\b/, 'telling the user what happened: toast, alert, badge, status'],
  ['action', /\b(buttons?|cta|call to action|fab)\b/, 'something to press: button, CTA'],
  ['input', /\b(inputs?|forms?|fields?|toggles?|switch(es)?|checkbox(es)?|radios?|sliders?|text ?box(es)?|date pickers?|search box(es)?|checklists?)\b/, 'collecting input: field, toggle, checkbox, slider'],
  ['navigation', /\b(nav|navigation|navbars?|menus?|tabs?|breadcrumbs?|pagination|sidebars?|drawers?|steppers?|dropdowns?)\b/, 'moving around: menu, tabs, breadcrumbs'],
  ['media', /\b(videos?|audio|players?|carousels?|image gallery)\b/, 'media playback or browsing'],
];

const BACKGROUND = /\b(backgrounds?|backdrops?|wallpapers?|behind (the )?content|ambient)\b/;
const REDUCED = /\b(reduced[- ]motion|motion[- ]safe|motion[- ]sensitiv\w*|vestibular|prefers-reduced-motion|accessib\w*|a11y|wcag)\b/;
const STATIC = /\b(static|no (animation|motion)|non[- ]animated|without (animation|motion))\b/;
const ANIMATED = /\b(animated|animating|animation|moving|pulsing|pulses?|live)\b/;
const NO_JS = /\b(no[- ]?js|no javascript|without (js|javascript)|css[- ]only|pure css)\b/;
const AWS = /\b(aws|amazon|vpcs?|subnets?|lambda|ec2|s3|rds|aurora|security groups?|nacls?|network acls?|cloudfront|route ?53|ipv6|dual[- ]stack|transit gateway|reference architecture|architecture diagrams?|cloudformation|terraform)\b/;
const CHART_ROLE = /\b(charts?|graphs?|plots?|visuali[sz]\w*|dashboards?|kpis?|tables?)\b/;

// Theme names as people say them -> design system id.
const DS_WORDS = [
  ['cloudscape', /\bcloudscape\b/], ['duolingo', /\bduolingo\b/], ['mailchimp', /\bmailchimp\b/],
  ['stackoverflow', /\bstack ?overflow\b/], ['monzo', /\bmonzo\b/], ['heroku', /\bheroku\b/],
  ['polaris', /\b(shopify )?polaris\b/], ['primer', /\b(github )?primer\b/], ['antd', /\b(ant ?design|antd)\b/],
  ['acorn', /\b(firefox )?acorn\b/], ['material3', /\bmaterial( ?3| design| you)?\b/], ['cloudflare', /\bcloudflare\b/],
  ['aero', /\b(frutiger )?aero\b/], ['glass', /\bliquid glass\b/], ['gcp', /\b(gcp|google cloud)\b/], ['fluent', /\b(fluent|azure)\b/],
];

const STOP = new Set('a an the and or for of to in on with without that this my our your me we it its is are be as at by from into show shows make need needs want wants use using some any one two three which what when where who how state states page pages app ui component components element elements style styled like look looks looking'.split(' '));

/**
 * Read an intent. Returns { filters (search_effects shape), prefer: { selfAnimates?, noJs? },
 * aws, theme (a theme or design-system id, or null), terms (ranking words), rules: [why] }.
 */
export function readIntent(text) {
  const s = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9%+\s-]/g, ' ').replace(/\s+/g, ' ')} `;
  const filters = {};
  const prefer = {};
  const rules = [];
  const chart = CHART_CONTEXT.test(s);
  // An AWS architecture is one kind of facet (the aws gallery, all flow diagrams): no role or shape.
  const aws = AWS.test(s);

  const shapes = [];
  for (const [shape, strong, weak, why] of aws ? [] : SHAPES) {
    if (strong.test(s) || (weak && chart && weak.test(s))) { shapes.push(shape); rules.push(`dataShape ${shape}: ${why}`); }
  }
  if (shapes.length) filters.dataShapes = shapes;

  const background = !aws && BACKGROUND.test(s);
  if (background) {
    filters.usableAsBackground = true;
    rules.push('usableAsBackground true: a backdrop that sits behind content (the authored flag; layer "background" alone also covers foreground objects)');
  }

  const roles = [];
  if (!background && !aws) {
    for (const [role, re, why] of ROLES) if (re.test(s)) { roles.push(role); rules.push(`role ${role}: ${why}`); }
    if (!roles.length && (shapes.length || CHART_ROLE.test(s))) { roles.push('data-display'); rules.push('role data-display: charts, KPIs, tables'); }
  }
  if (roles.length) filters.roles = roles;

  const motionText = s.replace(REDUCED, ' ');
  if (REDUCED.test(s)) { filters.reducedMotionSafe = true; rules.push('reducedMotionSafe true: static, or stops under prefers-reduced-motion'); }
  if (STATIC.test(s)) { filters.selfAnimates = false; rules.push('selfAnimates false: no motion of its own'); }
  else if (ANIMATED.test(motionText)) { prefer.selfAnimates = true; rules.push('prefers self-animating facets'); }

  if (NO_JS.test(s)) { filters.needsJs = false; rules.push('needsJs false: CSS and SVG only'); } else prefer.noJs = true;

  if (aws) { filters.galleries = ['aws']; rules.push('gallery aws: AWS architecture diagrams built by the AWS kit'); }

  let theme = null;
  for (const [ds, re] of DS_WORDS) {
    if (!re.test(s)) continue;
    const sys = designSystems().find((x) => x.ds === ds);
    if (!sys) continue;
    const mode = /\b(light|day)\b/.test(s) ? 'light' : /\b(dark|night)\b/.test(s) ? 'dark' : null;
    theme = mode ? sys[mode] : sys.ds;
    rules.push(`theme ${theme}: compose { theme: "${theme}" }${mode ? '' : ' (Auto: both modes, follows the system)'}`);
    break;
  }

  // ranking words: the theme's name only picks the token block, never the facets
  const words = s.replace(/\bcall to action\b/g, ' cta ').trim().split(' ');
  const terms = [...new Set(words.filter((w) => w.length > 1 && !STOP.has(w) && !/^(light|dark|theme|mode)$/.test(w) && !DS_WORDS.some(([, re]) => re.test(` ${w} `))))];
  return { filters, prefer, aws, theme, terms, rules };
}

