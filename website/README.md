# Prism website

A static project landing page with real catalog previews, searchable gallery links,
copyable snippets, light/dark themes, motion controls, and browser/MCP quick starts.
No external assets, package installation, or runtime dependencies.

Build from the repository root:

```sh
node website/build.mjs
```

The generated `site-dist/` directory contains the landing page, its assets, and the
original `Prism.html`. Serve that directory with any static host. Relative URLs
work at a GitHub Pages project path or a custom-domain root.

An optional output directory can be passed as the first argument:

```sh
node website/build.mjs /path/to/output
```

The build regenerates six CSS-only previews from the authoritative embedded
catalog and checks that the displayed gallery counts match it. Values shown in
those previews are original sample data. The agent workflow is an illustration;
the MCP server runs locally, not in the website.

In this fork, `.github/workflows/pages.yml` builds the site and publishes it to
GitHub Pages at [prism.k33bz.com](https://prism.k33bz.com) on every push to main.
The gallery counts in `index.html` must match the catalog, or the build (and the
deploy) fails: update them whenever facets are added.
