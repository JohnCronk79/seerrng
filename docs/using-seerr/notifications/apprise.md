---
title: Apprise
description: Send Seerr notifications through an Apprise API server.
sidebar_position: 11
---

# Apprise

[Apprise API](https://github.com/caronc/apprise-api) sends one message to any
of the services Apprise supports, such as Pushover, Telegram, Matrix, email,
and many others. Seerr posts to a saved Apprise configuration, so the
destination URLs and their secrets stay on your Apprise server.

Apprise is configured by a server administrator only. Users cannot add their
own Apprise destinations.

## Configuration

### Apprise API Root URL

Set this to the base address of your Apprise API server, for example
`http://apprise:8000`. Do not include `/notify`.

### Configuration Key

Set this to the name of a configuration you saved on the Apprise server.
Use 1 to 64 letters, numbers, hyphens, or underscores. Seerr sends each
notification to `/notify/{Configuration Key}`.

### Tag (optional)

Set this to an Apprise tag to send only to destinations on the Apprise server
that carry that tag.

### Username and Password Authentication (optional)

Turn this on when your Apprise server requires credentials (see
`APPRISE_AUTH_REQUIRED` in the Apprise API documentation). Seerr sends them as
HTTP Basic authentication.

:::info
Apprise messages are plain text. Seerr does not send posters, so the
**Embed Poster** option is not available for Apprise.
:::

### Notification Language

Sets the language for notifications sent through this Apprise server.
