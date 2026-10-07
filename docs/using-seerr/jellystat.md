---
title: Jellystat
description: Show lifetime play counts from Jellystat on Jellyfin titles.
sidebar_position: 26
---

# Jellystat

[Jellystat](https://github.com/CyferShepard/Jellystat) keeps a history of
Jellyfin playback. When you connect it, SeerrNG shows lifetime play counts and
playback time on titles that are linked to a Jellyfin item. Only administrators
see this summary.

The connection is read-only. SeerrNG does not change anything in Jellystat.

## Connect a server

1. Create an API key in Jellystat under its API keys settings.
2. Open **Settings > Services** and find **Jellystat Statistics**.
3. Select **Connect Jellystat Server**.
4. Enter the server URL, for example `http://jellystat:3000`, and the API key.
5. Select **Test Connection**, then **Connect**.

The API key stays on the SeerrNG server.

## What is shown

On a title's management panel, **Jellystat Watch Activity** shows the total
number of plays and the total playback time that Jellystat recorded. SeerrNG
asks Jellystat for the last ten years of history, so the totals cover that
window.

Titles that are not linked to a Jellyfin item do not show the summary.
