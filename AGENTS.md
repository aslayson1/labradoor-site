# Public Labradoor page rules

These rules apply to every new or edited public marketing page, product guide, and article.

- Every new standalone indexable page must be registered in Labradoor's dynamic sitemap, owned by `aslayson1/Pipeline` at `app/publication/labradoor/sitemap.xml/route.ts`. Update both repositories in the same task. Do not create a competing static sitemap.
- Published Labradoor blog articles marked `INDEX` enter that sitemap automatically through Content Studio. Preserve publication ownership and published/index-status filters.
- Link each new page from at least one relevant existing public page, with descriptive links to related pages. Do not create orphan pages.
- Verify the live production page returns 200, includes useful content without JavaScript, a unique title and description, and a self-referencing `https://www.labradoor.ai` canonical. Verify its presence in `https://www.labradoor.ai/sitemap.xml`.
- Preserve preview noindex protection. Never expose admin, API, tenant-app, or private token routes through a sitemap or public analytics.
- Remove deleted pages from the sitemap. Use a genuine 404/410 or a relevant permanent redirect rather than returning homepage HTML with status 200.
- Routine publishing must not depend on manual Google Search Console submissions. Google can discover updates through the already-submitted sitemap and internal links. Manual requests are optional for priority updates and troubleshooting; indexing and ranking are not guaranteed.
- Use accurate product claims, distinguish estimates and research signals from confirmed outcomes, and keep the iPhone, web, and Chrome workflows accurate.
- Public guide analytics must remain anonymous and separate from private application activity. Do not claim verified subscriber attribution without testing the conversion flow.

Check the initial HTML, metadata, sitemap membership, internal links, and mobile layout before marking a page complete. Avoid preview deployments unless the user asks for one.
