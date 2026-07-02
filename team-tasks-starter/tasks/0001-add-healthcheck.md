---
id: 0001
title: Add a /healthcheck endpoint
status: open
project: app-a
branch: task/0001-healthcheck
assignee:
priority: normal
skills: [dev, run-tests]
env_required: []
updated: 2026-06-30
links: {}
---

## Spec
We need a lightweight liveness endpoint so uptime monitoring can check the app without hitting
real routes.

Acceptance criteria:

- [ ] `GET /healthcheck` returns HTTP 200 with JSON `{ "status": "ok" }`.
- [ ] It does **not** require auth.
- [ ] It does not touch the database (pure liveness, no readiness checks for now).
- [ ] A test covers the 200 + body.

## Research
<!-- worker fills -->

## Plan
<!-- worker fills -->

## Tasks
- [ ] Add the route handler
- [ ] Add a test
- [ ] Update the changelog

## Progress log

## Handover
