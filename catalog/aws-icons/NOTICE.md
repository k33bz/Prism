# AWS Architecture Icons: notice

The icons in this folder (`aws-icons.json`, `aws-icons.svg`) and the sprite embedded in Prism's
**AWS Architecture** gallery come from the official **AWS Architecture Icons** package published by
Amazon Web Services:

- Source: https://aws.amazon.com/architecture/icons/
- Package: `Icon-package_07312026.zip` (Q3 2026 release), 859 icons used
  (305 service, 513 resource, 15 group, 26 category)

AWS provides these icons so customers and partners can draw architecture diagrams. They remain the
property of Amazon.com, Inc. or its affiliates; AWS, the AWS service names and the icons are
trademarks of Amazon. This project is not affiliated with or endorsed by AWS. Follow AWS's usage
guidance on the page above: use each icon to represent the service or resource it stands for, and
do not alter the artwork.

## What was changed

Nothing in the artwork. `build_icons.mjs` only:

- keeps one size per icon (service and resource 48 px, group 32 px, category 48 px), plus the
  official Dark and Light colorway variants where the package provides them;
- strips XML declarations, comments, `<title>` elements and unreferenced Sketch layer ids;
- namespaces the ids that are referenced (clip paths) per icon so they cannot collide in a sprite;
- rounds coordinates to 2 decimals (sub-pixel at any practical render size) and removes whitespace;
- merges Prism's own metadata from `overlay.mjs` into `aws-icons.json`: aliases, short display names,
  lifecycle status (retired, end of support, renamed, duplicate) and crosswalks from draw.io, Mermaid,
  PlantUML, Python diagrams, CloudFormation and Terraform names. Ids stay as the package names them,
  including its typo `aws-res-aurora-rds-instance-aternate` and its duplicate service ids.

## Rebuilding

```bash
# unzip the package from the page above, then:
node catalog/aws-icons/build_icons.mjs <unzipped Icon-package directory>
# after editing overlay.mjs (no package needed; artwork and sprite untouched):
node catalog/aws-icons/build_icons.mjs --overlay-only
```

Ids follow `aws-svc-<service>`, `aws-res-<service>-<resource>`, `aws-grp-<group>` and
`aws-cat-<category>`, with `-dark` / `-light` suffixes for colorway pairs. Search them with
`node catalog/aws-kit/awd.mjs icons <words>` or in the gallery's icon library, and resolve any name
("S3 bucket", `AWS::Lambda::Function`, `mxgraph.aws4.nat_gateway`) with `node catalog/aws-icons/resolve.mjs <name>`.
