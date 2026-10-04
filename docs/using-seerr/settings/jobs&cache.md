---
title: Jobs & Cache
description: Configure jobs and cache settings.
sidebar_position: 6
---

# Jobs & Cache

Seerr performs certain maintenance tasks as regularly-scheduled jobs, but they can also be manually triggered on this page.

Seerr also caches requests to external API endpoints to optimize performance and avoid making unnecessary API calls. If necessary, the cache for any particular endpoint can be cleared by clicking the "Flush Cache" button.

## API Cache

The API cache stores responses from external services such as metadata providers and automation backends. The Jobs & Cache page shows cache hit counts, miss counts, key counts, and approximate key/value sizes for each cache.

Use "Flush Cache" when you need Seerr to discard cached external API responses and refetch fresh data.

## DNS Cache

If DNS caching is enabled in **Settings → Network**, this page also shows DNS cache entries and aggregate DNS cache statistics. Individual hostnames can be flushed without clearing all application caches.

## Image Cache

When image caching is enabled in **Settings → General**, Seerr proxies and stores supported external images under `config/cache/images`. The Jobs & Cache page shows the current image count and cache size.

Image responses include browser cache headers and validators so browsers can reuse cached images or receive efficient `304 Not Modified` responses. Seerr also warms visible media images in the background, dedupes repeated warmup requests, and delays off-screen warmup work so the visible page can populate first.

## Browser Runtime Cache

Modern browsers can also use Seerr's service worker to keep a bounded runtime cache for cacheable API responses, static assets, avatar proxy responses, and image proxy responses. This helps refreshes, tab restores, and repeat browsing avoid unnecessary full repopulation.

The service worker registers independently of web push notification setup. Web push still requires user permission and the Web Push notification agent, but the runtime cache does not.

If Seerr is behind a reverse proxy, make sure the proxy preserves cache headers for cacheable API routes, static assets, `/imageproxy/*`, `/avatarproxy/*`, and `/sw.js`. A proxy-level `Cache-Control: no-store` header on these paths will prevent browser caching from working correctly.
